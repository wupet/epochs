/**
 * The client's mirror of the server's world, built from `welcome` and `tick` messages, plus the
 * motion that draws each character sliding to its latest tile. Pure: time is passed in as `nowMs`.
 */
import { gridFromRows } from '@epochs/shared';
import type {
  CharacterId,
  Grid,
  QueueMessage,
  ServerMessage,
  Tile,
  TickMessage,
  WelcomeMessage,
} from '@epochs/shared';
import { msPerTile, positionAt, retarget, stillAt } from './motion';
import type { Motion, Point } from './motion';

export class ClientWorld {
  private _you: CharacterId | null = null;
  private _tick = -1;
  private _grid: Grid | null = null;
  /** Each character's slide; its last point is its latest server tile. */
  private readonly motions = new Map<CharacterId, Motion>();
  /** Each character's latest speed, in millitiles per tick. */
  private readonly speeds = new Map<CharacterId, number>();
  private _queuePosition: number | null = null;

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

  /** Replace everything with what the welcome says. Everyone is still at their tile. */
  applyWelcome(msg: WelcomeMessage, nowMs: number): void {
    this._you = msg.you;
    this._tick = msg.tick;
    this._grid = gridFromRows(msg.grid.rows);
    this._queuePosition = null;
    this.motions.clear();
    this.speeds.clear();
    for (const c of msg.characters) {
      this.motions.set(c.id, stillAt(c, nowMs));
      this.speeds.set(c.id, c.speed);
    }
  }

  /** Note your place in the join queue. */
  applyQueue(msg: QueueMessage): void {
    this._queuePosition = msg.position;
  }

  /**
   * Apply a tick. Returns false, changing nothing, if the tick is not newer than the current one
   * (stale, repeated, or no welcome yet). Moved characters slide from where they are drawn now.
   */
  applyTick(msg: TickMessage, nowMs: number): boolean {
    if (this._grid === null || msg.tick <= this._tick) return false;
    for (const id of msg.left) {
      this.motions.delete(id);
      this.speeds.delete(id);
    }
    for (const c of msg.joined) {
      this.motions.set(c.id, stillAt(c, nowMs));
      this.speeds.set(c.id, c.speed);
    }
    for (const c of msg.moved) {
      // The speed is updated first, so the first step after a debug mode change slides at the new speed.
      this.speeds.set(c.id, c.speed);
      const motion = this.motions.get(c.id);
      this.motions.set(
        c.id,
        motion === undefined
          ? stillAt(c, nowMs)
          : retarget(motion, [...c.via, { x: c.x, y: c.y }], nowMs, msPerTile(c.speed)),
      );
    }
    this._tick = msg.tick;
    return true;
  }

  /** The latest server tile: where the character will be, not where it is drawn. */
  tileOf(id: CharacterId): Tile | undefined {
    const motion = this.motions.get(id);
    if (motion === undefined) return undefined;
    const last = motion.points[motion.points.length - 1]!;
    return { x: last.x, y: last.y };
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
}

/** A light check of a raw server message: a JSON object whose type is 'welcome', 'tick' or 'queue'. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = (value as { type?: unknown }).type;
  if (type !== 'welcome' && type !== 'tick' && type !== 'queue') return null;
  return value as ServerMessage;
}
