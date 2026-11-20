/**
 * The client's mirror of the server's world, built from `welcome` and `tick` messages, plus the
 * motion that draws each character and enemy sliding to its latest tile. Pure: time is passed in
 * as `nowMs`. No Zod: this imports only types and plain code from `@epochs/shared`.
 */
import { gridFromRows } from '@epochs/shared';
import type {
  CharacterId,
  DebugCatalog,
  EnemyId,
  EnemyView,
  Grid,
  QueueMessage,
  RecapMessage,
  Ref,
  ServerMessage,
  SheetMessage,
  TelegraphView,
  Tile,
  TickMessage,
  WelcomeMessage,
} from '@epochs/shared';
import { SQUARE_INSET } from './combat-style';
import { addHits, visible } from './floating-numbers';
import type { FloatingNumber } from './floating-numbers';
import { msPerTile, positionAt, retarget, stillAt } from './motion';
import type { Motion, Point } from './motion';

/** An enemy as drawn: its slide, and what the server last said about it. */
interface EnemyState {
  motion: Motion;
  name: string;
  family: string;
  health: number;
  maxHealth: number;
}

/** A damage number as the renderer wants it: where, how much, whose, and how long it has floated (ms). */
export interface FloatingNumberView {
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly mine: 'dealt' | 'taken';
  readonly age: number;
}

export class ClientWorld {
  private _you: CharacterId | null = null;
  private _tick = -1;
  private _grid: Grid | null = null;
  /** Each character's slide; its last point is its latest server tile. */
  private readonly motions = new Map<CharacterId, Motion>();
  /** Each character's latest speed, in millitiles per tick. */
  private readonly speeds = new Map<CharacterId, number>();
  /** Each player's latest health and maximum health. */
  private readonly vitals = new Map<CharacterId, { health: number; maxHealth: number }>();
  private readonly enemies = new Map<EnemyId, EnemyState>();
  private _telegraphs: readonly TelegraphView[] = [];
  private _campfire: Tile | null = null;
  private _catalog: DebugCatalog | null = null;
  private _sheet: SheetMessage | null = null;
  private _recap: RecapMessage | null = null;
  private numbers: FloatingNumber[] = [];
  private _queuePosition: number | null = null;
  private _serverFull = false;

  get you(): CharacterId | null {
    return this._you;
  }

  get tick(): number {
    return this._tick;
  }

  get grid(): Grid | null {
    return this._grid;
  }

  /** Your place in the queue while waiting to join, or null when not queued (or once welcomed). */
  get queuePosition(): number | null {
    return this._queuePosition;
  }

  /** True once the server has said that it and its queue are full. It stays true after the socket closes. */
  get serverFull(): boolean {
    return this._serverFull;
  }

  /** Every active telegraph, replaced on every tick. */
  get telegraphs(): readonly TelegraphView[] {
    return this._telegraphs;
  }

  /** The campfire where players respawn, or null if the world has none (or before the welcome). */
  get campfire(): Tile | null {
    return this._campfire;
  }

  /** Debug: what the debug panel may choose from. Null before the welcome. */
  get catalog(): DebugCatalog | null {
    return this._catalog;
  }

  /** Your own sheet, once the server has sent it (it follows the welcome). */
  get sheet(): SheetMessage | null {
    return this._sheet;
  }

  /** The recap of your last death, until it is dismissed. */
  get recap(): RecapMessage | null {
    return this._recap;
  }

  /** Replace everything with what the welcome says. Everyone is still at their tile. */
  applyWelcome(msg: WelcomeMessage, nowMs: number): void {
    this._you = msg.you;
    this._tick = msg.tick;
    this._grid = gridFromRows(msg.grid.rows);
    this._queuePosition = null;
    this.motions.clear();
    this.speeds.clear();
    this.vitals.clear();
    this.enemies.clear();
    this.numbers = [];
    this._sheet = null;
    this._recap = null;
    this._campfire = msg.campfire === null ? null : { x: msg.campfire.x, y: msg.campfire.y };
    this._catalog = msg.catalog;
    this._telegraphs = msg.telegraphs;
    for (const c of msg.characters) {
      this.motions.set(c.id, stillAt(c, nowMs));
      this.speeds.set(c.id, c.speed);
      this.vitals.set(c.id, { health: c.health, maxHealth: c.maxHealth });
    }
    for (const e of msg.enemies) this.enemies.set(e.id, enemyStill(e, nowMs));
  }

  /** Keep your own sheet. */
  applySheet(msg: SheetMessage): void {
    this._sheet = msg;
  }

  /** Keep the recap of your death, to show until it is dismissed. */
  applyRecap(msg: RecapMessage): void {
    this._recap = msg;
  }

  dismissRecap(): void {
    this._recap = null;
  }

  /** Note your place in the join queue. */
  applyQueue(msg: QueueMessage): void {
    this._queuePosition = msg.position;
  }

  /** Note that the server turned this connection away because it and its queue are full. */
  applyFull(): void {
    this._serverFull = true;
  }

  /**
   * Apply a tick. Returns false, changing nothing, if the tick is not newer than the current one
   * (stale, repeated, or no welcome yet). Moved characters and enemies slide from where they are
   * drawn now. A respawned player is drawn at their new tile at once. A downed player stays drawn
   * where they fell, with no health.
   */
  applyTick(msg: TickMessage, nowMs: number): boolean {
    if (this._grid === null || msg.tick <= this._tick) return false;
    // Hits first: a number sits where its target is drawn when the hit arrives, even if this same
    // tick removes or respawns the target.
    this.numbers = addHits(this.numbers, msg.hits, this._you ?? -1, (ref) => this.drawnAt(ref, nowMs), nowMs);

    for (const id of msg.left) {
      this.motions.delete(id);
      this.speeds.delete(id);
      this.vitals.delete(id);
    }
    for (const c of msg.joined) {
      this.motions.set(c.id, stillAt(c, nowMs));
      this.speeds.set(c.id, c.speed);
      this.vitals.set(c.id, { health: c.health, maxHealth: c.maxHealth });
    }
    const respawned = new Set(msg.respawned);
    for (const c of msg.moved) {
      // The speed is updated first, so the first step after a debug mode change slides at the new speed.
      this.speeds.set(c.id, c.speed);
      this.vitals.set(c.id, { health: c.health, maxHealth: c.maxHealth });
      const motion = this.motions.get(c.id);
      this.motions.set(
        c.id,
        motion === undefined || respawned.has(c.id)
          ? stillAt(c, nowMs)
          : retarget(motion, [...c.via, { x: c.x, y: c.y }], nowMs, msPerTile(c.speed)),
      );
    }
    for (const v of msg.vitals) {
      if (this.vitals.has(v.id)) this.vitals.set(v.id, { health: v.health, maxHealth: v.maxHealth });
    }
    for (const id of msg.downed) {
      const v = this.vitals.get(id);
      if (v !== undefined) v.health = 0;
    }

    for (const id of msg.enemies.removed) this.enemies.delete(id);
    for (const e of msg.enemies.spawned) this.enemies.set(e.id, enemyStill(e, nowMs));
    for (const e of msg.enemies.moved) {
      const known = this.enemies.get(e.id);
      if (known === undefined) {
        this.enemies.set(e.id, enemyStill(e, nowMs));
        continue;
      }
      known.motion = retarget(known.motion, [...e.via, { x: e.x, y: e.y }], nowMs, msPerTile(e.speed));
      known.health = e.health;
      known.maxHealth = e.maxHealth;
    }
    for (const v of msg.enemies.vitals) {
      const known = this.enemies.get(v.id);
      if (known !== undefined) {
        known.health = v.health;
        known.maxHealth = v.maxHealth;
      }
    }

    this._telegraphs = msg.telegraphs;
    this.numbers = visible(this.numbers, nowMs);
    this._tick = msg.tick;
    return true;
  }

  /** Where a player or enemy is drawn at `nowMs`. */
  private drawnAt(ref: Ref, nowMs: number): Point | undefined {
    return ref.side === 'player' ? this.positionOf(ref.id, nowMs) : this.enemyPositionOf(ref.id, nowMs);
  }

  /** The latest server tile: where the character will be, not where it is drawn. */
  tileOf(id: CharacterId): Tile | undefined {
    const motion = this.motions.get(id);
    return motion === undefined ? undefined : lastTile(motion);
  }

  /** Where the character is drawn at `nowMs`. */
  positionOf(id: CharacterId, nowMs: number): Point | undefined {
    const motion = this.motions.get(id);
    return motion === undefined ? undefined : positionAt(motion, nowMs);
  }

  /** The character's latest speed in millitiles per tick, if it is known. */
  speedOf(id: CharacterId): number | undefined {
    return this.speeds.get(id);
  }

  ids(): CharacterId[] {
    return [...this.motions.keys()];
  }

  /** A player's current health (0 while down), if they are known. */
  healthOf(id: CharacterId): number | undefined {
    return this.vitals.get(id)?.health;
  }

  maxHealthOf(id: CharacterId): number | undefined {
    return this.vitals.get(id)?.maxHealth;
  }

  enemyIds(): EnemyId[] {
    return [...this.enemies.keys()];
  }

  /** Where the enemy is drawn at `nowMs`. */
  enemyPositionOf(id: EnemyId, nowMs: number): Point | undefined {
    const enemy = this.enemies.get(id);
    return enemy === undefined ? undefined : positionAt(enemy.motion, nowMs);
  }

  /** The enemy's latest server tile: where it will be, not where it is drawn. */
  enemyTileOf(id: EnemyId): Tile | undefined {
    const enemy = this.enemies.get(id);
    return enemy === undefined ? undefined : lastTile(enemy.motion);
  }

  /** The enemy standing on `tile` by its latest server tile, if any. */
  enemyAt(tile: Tile): EnemyId | undefined {
    for (const [id, enemy] of this.enemies) {
      const at = lastTile(enemy.motion);
      if (at.x === tile.x && at.y === tile.y) return id;
    }
    return undefined;
  }

  /**
   * The enemy a pointer at `point` (in tile units, fractional: tile (3, 2)'s centre is (3.5, 2.5))
   * is over at `nowMs`: first the one whose square is drawn under it (the same inset the renderer
   * uses, so a sliding body can be clicked where it is), else the one on the point's tile by its
   * latest server tile.
   */
  enemyUnderPoint(point: Point, nowMs: number): EnemyId | undefined {
    for (const id of this.enemies.keys()) {
      const pos = this.enemyPositionOf(id, nowMs);
      if (pos === undefined) continue;
      const lo = SQUARE_INSET;
      const hi = 1 - SQUARE_INSET;
      if (point.x >= pos.x + lo && point.x <= pos.x + hi && point.y >= pos.y + lo && point.y <= pos.y + hi) return id;
    }
    return this.enemyAt({ x: Math.floor(point.x), y: Math.floor(point.y) });
  }

  enemyInfo(id: EnemyId): { name: string; family: string; health: number; maxHealth: number } | undefined {
    const enemy = this.enemies.get(id);
    if (enemy === undefined) return undefined;
    const { name, family, health, maxHealth } = enemy;
    return { name, family, health, maxHealth };
  }

  /** The tiles the hover preview must route around: the enemies' latest server tiles. */
  blockerTiles(): Tile[] {
    return [...this.enemies.values()].map((e) => lastTile(e.motion));
  }

  /** The damage numbers still floating at `nowMs`: only hits you dealt or took. */
  floatingNumbers(nowMs: number): FloatingNumberView[] {
    return visible(this.numbers, nowMs).map((n) => ({
      x: n.x,
      y: n.y,
      amount: n.amount,
      mine: n.mine,
      age: nowMs - n.bornMs,
    }));
  }
}

function lastTile(motion: Motion): Tile {
  const last = motion.points[motion.points.length - 1]!;
  return { x: last.x, y: last.y };
}

function enemyStill(e: EnemyView, nowMs: number): EnemyState {
  return { motion: stillAt(e, nowMs), name: e.name, family: e.family, health: e.health, maxHealth: e.maxHealth };
}

const SERVER_MESSAGE_TYPES: readonly string[] = [
  'welcome',
  'tick',
  'sheet',
  'recap',
  'queue',
  'full',
] satisfies readonly ServerMessage['type'][];

/** A light check of a raw server message: a JSON object whose type is one the server sends. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !SERVER_MESSAGE_TYPES.includes(type)) return null;
  return value as ServerMessage;
}
