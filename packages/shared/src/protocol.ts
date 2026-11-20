/**
 * The wire protocol: what the server sends to clients and what clients may send back. Pure: no
 * randomness, no clock, no I/O. Reachable from the client, so it imports only Zod-free modules
 * (type-only imports of the content schemas are fine: they are erased).
 *
 * Hidden information never reaches the client. Every view is built field by field, never by copying
 * a whole record: a character leaves the server as `{ id, x, y, speed, health, maxHealth }` (a moved
 * one also carries `via`, the tiles it passed through), an enemy as `{ id, x, y, speed, name, family,
 * health, maxHealth }`. Paths, progress, orders, resistances, who last hit whom, recent hits (except
 * in the owner's recap), the generator state and other players' sheets are never copied into a
 * message. Debug messages have types starting with `debug-`.
 */
import { gridToRows, inBounds } from './grid';
import type { Grid } from './grid';
import { isDebugMovementMode } from './movement';
import type { DebugMovementMode } from './movement';
import { lookup } from './content/bundle';
import type { ContentBundle } from './content/bundle';
import { ATTRIBUTES, ID_PATTERN } from './content/vocabulary';
import type { Attribute, DamageKind } from './content/vocabulary';
import { MAX_CLASS_RANK, MAX_LEVEL, attributesOf, maxHealthOf } from './character';
import type { Attributes } from './character';
import type { Character, CharacterId, Enemy, EnemyId, Hit, Recap, Ref, WorldState } from './world';

/** What a client may see of a character. */
export interface CharacterView {
  readonly id: CharacterId;
  readonly x: number;
  readonly y: number;
  /** Millitiles of progress per tick. */
  readonly speed: number;
  /** 0 for a player who is down. */
  readonly health: number;
  readonly maxHealth: number;
}

/** A character that moved this tick: `via` lists the tiles it passed through before its final one. */
export interface MovedView extends CharacterView {
  readonly via: readonly { readonly x: number; readonly y: number }[];
}

/** What a client may see of an enemy. */
export interface EnemyView {
  readonly id: EnemyId;
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  readonly name: string;
  readonly family: string;
  readonly health: number;
  readonly maxHealth: number;
}

/** An enemy that moved this tick, with the tiles it passed through before its final one. */
export interface MovedEnemyView extends EnemyView {
  readonly via: readonly { readonly x: number; readonly y: number }[];
}

/** A health change: for a character or (in `enemies.vitals`) an enemy. */
export interface VitalsView {
  readonly id: number;
  readonly health: number;
  readonly maxHealth: number;
}

/** An attack being wound up, as everyone sees it. `resolvesAt` is the message tick on which it lands. */
export interface TelegraphView {
  readonly enemyId: EnemyId;
  readonly tiles: readonly { readonly x: number; readonly y: number }[];
  readonly kind: DamageKind;
  readonly resolvesAt: number;
}

/** A hit that landed this tick. Names, telegraph and tick stay on the server (the owner's recap has them). */
export interface HitView {
  readonly attacker: Ref;
  readonly target: Ref;
  readonly amount: number;
}

/** The grid as sent to a client: '#' is blocked, '.' is open, one string per row. */
export interface GridView {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

/** Debug: what the debug panel may choose from. Every list is sorted by id. */
export interface DebugCatalog {
  /** A preset's `mainAttribute` lets the panel's -/+ buttons move level points to and from it as the server does. */
  readonly presets: readonly { readonly id: string; readonly name: string; readonly mainAttribute: Attribute }[];
  /** A weapon's `rangeTiles` lets the client's hover preview route into reach as the server does. */
  readonly weapons: readonly { readonly id: string; readonly name: string; readonly rangeTiles: number }[];
  readonly armors: readonly { readonly id: string; readonly name: string }[];
  readonly classes: readonly { readonly id: string; readonly name: string }[];
  readonly waves: readonly { readonly id: string; readonly name: string }[];
  readonly maxLevel: number;
  readonly maxClassRank: number;
}

/** Sent once, when a client joins: the whole grid and everyone in it. */
export interface WelcomeMessage {
  readonly type: 'welcome';
  readonly you: CharacterId;
  readonly tick: number;
  readonly grid: GridView;
  readonly characters: readonly CharacterView[];
  readonly campfire: { readonly x: number; readonly y: number } | null;
  readonly enemies: readonly EnemyView[];
  readonly telegraphs: readonly TelegraphView[];
  readonly catalog: DebugCatalog;
}

/** Sent every tick: what changed since the last one. */
export interface TickMessage {
  readonly type: 'tick';
  readonly tick: number;
  readonly moved: readonly MovedView[];
  readonly joined: readonly CharacterView[];
  readonly left: readonly CharacterId[];
  /** Characters whose health or maximum health changed. */
  readonly vitals: readonly VitalsView[];
  /** Players who went down this tick. */
  readonly downed: readonly CharacterId[];
  /** Players who stood up this tick: draw them at their new tile at once, without a slide. Also in `moved`. */
  readonly respawned: readonly CharacterId[];
  readonly enemies: {
    readonly spawned: readonly EnemyView[];
    readonly moved: readonly MovedEnemyView[];
    readonly removed: readonly EnemyId[];
    readonly vitals: readonly VitalsView[];
  };
  /** Every active telegraph, not just the new ones. */
  readonly telegraphs: readonly TelegraphView[];
  readonly hits: readonly HitView[];
}

/** Private, to its owner only: their own sheet. Sent after the welcome and whenever it changes. */
export interface SheetMessage {
  readonly type: 'sheet';
  readonly presetId: string | null;
  readonly level: number;
  readonly attributes: Attributes;
  readonly levelPoints: Attributes;
  readonly weaponId: string | null;
  readonly armorId: string | null;
  readonly classRanks: Readonly<Record<string, number>>;
  readonly maxHealth: number;
}

/** Private, to its owner only: the last hits taken before going down. */
export interface RecapMessage {
  readonly type: 'recap';
  readonly tick: number;
  readonly hits: readonly {
    readonly tick: number;
    readonly attacker: string;
    readonly attack: string;
    readonly amount: number;
    readonly telegraph: { readonly name: string; readonly windupTicks: number } | null;
  }[];
}

/** Sent to a client waiting to join: its place in the queue. */
export interface QueueMessage {
  readonly type: 'queue';
  readonly position: number;
}

/** Sent to a connection turned away because both the world and its queue are full. The server then closes it. */
export interface FullMessage {
  readonly type: 'full';
}

export type ServerMessage = WelcomeMessage | TickMessage | SheetMessage | RecapMessage | QueueMessage | FullMessage;

/** A client's intention to walk to a tile. The server decides whether and how it happens. */
export interface MoveMessage {
  readonly type: 'move';
  readonly x: number;
  readonly y: number;
}

/** Debug: running and riding get real rules later. A client's request to change its movement mode. */
export interface ModeMessage {
  readonly type: 'mode';
  readonly mode: DebugMovementMode;
}

/** A client's intention to chase an enemy and attack it until it dies. */
export interface AttackMessage {
  readonly type: 'attack';
  readonly enemyId: EnemyId;
}

/** A client's intention to walk to a tile, attacking enemies that come into reach on the way. */
export interface AttackMoveMessage {
  readonly type: 'attack-move';
  readonly x: number;
  readonly y: number;
}

// Debug messages: each mirrors the `debug-…` intention of the same name (without the sender).
export interface DebugPresetMessage {
  readonly type: 'debug-preset';
  readonly presetId: string;
}
export interface DebugLevelMessage {
  readonly type: 'debug-level';
  readonly level: number;
}
export interface DebugMovePointMessage {
  readonly type: 'debug-move-point';
  readonly from: Attribute;
  readonly to: Attribute;
}
export interface DebugWeaponMessage {
  readonly type: 'debug-weapon';
  readonly itemId: string | null;
}
export interface DebugArmorMessage {
  readonly type: 'debug-armor';
  readonly itemId: string | null;
}
export interface DebugClassRankMessage {
  readonly type: 'debug-class-rank';
  readonly classId: string;
  readonly rank: number;
}
export interface DebugHealMessage {
  readonly type: 'debug-heal';
}
export interface DebugStartWaveMessage {
  readonly type: 'debug-start-wave';
  readonly waveId: string;
}
export interface DebugClearEnemiesMessage {
  readonly type: 'debug-clear-enemies';
}

/** Debug: every message the debug panel sends. */
export type DebugMessage =
  | DebugPresetMessage
  | DebugLevelMessage
  | DebugMovePointMessage
  | DebugWeaponMessage
  | DebugArmorMessage
  | DebugClassRankMessage
  | DebugHealMessage
  | DebugStartWaveMessage
  | DebugClearEnemiesMessage;

export type ClientMessage = MoveMessage | ModeMessage | AttackMessage | AttackMoveMessage | DebugMessage;

/** The longest client message the server will parse, in characters. */
export const MAX_CLIENT_MESSAGE_LENGTH = 256;

/** The longest id a client may send. */
export const MAX_ID_LENGTH = 64;

/** The only part of a character a client may see. Copies id, x, y, speed and health, and derives max health. */
export function viewOf(character: Character, content: ContentBundle): CharacterView {
  return {
    id: character.id,
    x: character.tile.x,
    y: character.tile.y,
    speed: character.speed,
    health: character.health,
    maxHealth: maxHealthOf(character.sheet, content),
  };
}

/** The only part of an enemy a client may see. An enemy whose content is missing shows its content id and no family. */
export function enemyViewOf(enemy: Enemy, content: ContentBundle): EnemyView {
  const enemyContent = lookup(content.enemies, enemy.contentId);
  return {
    id: enemy.id,
    x: enemy.tile.x,
    y: enemy.tile.y,
    speed: enemy.speed,
    name: enemyContent?.name ?? enemy.contentId,
    family: enemyContent?.family ?? '',
    health: enemy.health,
    maxHealth: enemyContent?.health ?? enemy.health,
  };
}

export function queueMessage(position: number): QueueMessage {
  return { type: 'queue', position };
}

export function fullMessage(): FullMessage {
  return { type: 'full' };
}

function byId(a: { readonly id: number }, b: { readonly id: number }): number {
  return a.id - b.id;
}

function byText(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every active telegraph, sorted by enemy id. One whose attack is missing from the content is left out. */
function telegraphsOf(state: WorldState): TelegraphView[] {
  const views: TelegraphView[] = [];
  for (const enemy of state.enemies) {
    const { windup } = enemy;
    if (windup === null) continue;
    const attack = lookup(state.content.enemies, enemy.contentId)?.attacks.find((a) => a.id === windup.attackId);
    const kind = attack?.damage[0]?.kind;
    if (kind === undefined) continue;
    views.push({
      enemyId: enemy.id,
      tiles: windup.tiles.map((t) => ({ x: t.x, y: t.y })),
      kind,
      resolvesAt: windup.resolvesAt + 1,
    });
  }
  return views.sort((a, b) => a.enemyId - b.enemyId);
}

/** Debug: the choices for the debug panel, each list sorted by id. */
export function debugCatalog(content: ContentBundle): DebugCatalog {
  const items = Object.values(content.items);
  const named = (list: readonly { readonly id: string; readonly name: string }[]): { id: string; name: string }[] =>
    list.map((e) => ({ id: e.id, name: e.name })).sort(byText);
  return {
    presets: Object.values(content.presets)
      .map((p) => ({ id: p.id, name: p.name, mainAttribute: p.mainAttribute }))
      .sort(byText),
    weapons: items
      .flatMap((i) => (i.weapon ? [{ id: i.id, name: i.name, rangeTiles: i.weapon.rangeTiles }] : []))
      .sort(byText),
    armors: named(items.filter((i) => i.armor)),
    classes: named(Object.values(content.classes)),
    waves: named(Object.values(content.waves)),
    maxLevel: MAX_LEVEL,
    maxClassRank: MAX_CLASS_RANK,
  };
}

export function welcomeMessage(state: WorldState, you: CharacterId): WelcomeMessage {
  return {
    type: 'welcome',
    you,
    tick: state.tick,
    grid: { width: state.grid.width, height: state.grid.height, rows: gridToRows(state.grid) },
    characters: state.characters.map((c) => viewOf(c, state.content)).sort(byId),
    campfire: state.campfire === null ? null : { x: state.campfire.x, y: state.campfire.y },
    enemies: state.enemies.map((e) => enemyViewOf(e, state.content)).sort(byId),
    telegraphs: telegraphsOf(state),
    catalog: debugCatalog(state.content),
  };
}

/** A player's own sheet, or null if they are not in the world. Never send it to anyone else. */
export function sheetMessage(state: WorldState, id: CharacterId): SheetMessage | null {
  const character = state.characters.find((c) => c.id === id);
  if (!character) return null;
  const { sheet } = character;
  return {
    type: 'sheet',
    presetId: sheet.presetId,
    level: sheet.level,
    attributes: attributesOf(sheet, state.content),
    levelPoints: { ...sheet.levelPoints },
    weaponId: sheet.weaponId,
    armorId: sheet.armorId,
    classRanks: { ...sheet.classRanks },
    maxHealth: maxHealthOf(sheet, state.content),
  };
}

/** A death recap for its owner: the hits, each with names and the telegraph it came from. */
export function recapMessage(recap: Recap): RecapMessage {
  return {
    type: 'recap',
    tick: recap.tick,
    hits: recap.hits.map((h) => ({
      tick: h.tick,
      attacker: h.attackerName,
      attack: h.attackName,
      amount: h.amount,
      telegraph: h.telegraph === null ? null : { name: h.telegraph.name, windupTicks: h.telegraph.windupTicks },
    })),
  };
}

function hitView(hit: Hit): HitView {
  return {
    attacker: { side: hit.attacker.side, id: hit.attacker.id },
    target: { side: hit.target.side, id: hit.target.id },
    amount: hit.amount,
  };
}

/**
 * What changed between two consecutive ticks. Every list is sorted by id (hits keep their event
 * order). A player who stood up this tick is in `respawned` and in `moved` with an empty `via`, even
 * if the new tile is the old one. An enemy that appeared this tick is only in `spawned`, at its
 * end-of-tick position. `telegraphs` is the full list of active ones.
 */
export function tickMessage(prev: WorldState, next: WorldState): TickMessage {
  const content = next.content;
  const before = new Map<CharacterId, Character>(prev.characters.map((c) => [c.id, c]));
  const after = new Map<CharacterId, Character>(next.characters.map((c) => [c.id, c]));
  const stoodUp = new Set<CharacterId>(next.respawned);

  const joined: CharacterView[] = [];
  const moved: MovedView[] = [];
  const vitals: VitalsView[] = [];
  for (const character of next.characters) {
    const old = before.get(character.id);
    if (old === undefined) {
      joined.push(viewOf(character, content));
      continue;
    }
    if (stoodUp.has(character.id)) {
      moved.push({ ...viewOf(character, content), via: [] });
    } else if (old.tile.x !== character.tile.x || old.tile.y !== character.tile.y) {
      const via = character.stepped.slice(0, -1).map((t) => ({ x: t.x, y: t.y }));
      moved.push({ ...viewOf(character, content), via });
    }
    const maxHealth = maxHealthOf(character.sheet, content);
    if (old.health !== character.health || maxHealthOf(old.sheet, prev.content) !== maxHealth) {
      vitals.push({ id: character.id, health: character.health, maxHealth });
    }
  }
  const left: CharacterId[] = prev.characters.filter((c) => !after.has(c.id)).map((c) => c.id);

  const enemiesBefore = new Map<EnemyId, Enemy>(prev.enemies.map((e) => [e.id, e]));
  const enemiesAfter = new Set<EnemyId>(next.enemies.map((e) => e.id));
  const spawned: EnemyView[] = [];
  const enemiesMoved: MovedEnemyView[] = [];
  const enemyVitals: VitalsView[] = [];
  for (const enemy of next.enemies) {
    const old = enemiesBefore.get(enemy.id);
    const view = enemyViewOf(enemy, content);
    if (old === undefined) {
      spawned.push(view);
      continue;
    }
    if (old.tile.x !== enemy.tile.x || old.tile.y !== enemy.tile.y) {
      enemiesMoved.push({ ...view, via: enemy.stepped.slice(0, -1).map((t) => ({ x: t.x, y: t.y })) });
    }
    if (old.health !== enemy.health) {
      enemyVitals.push({ id: enemy.id, health: enemy.health, maxHealth: view.maxHealth });
    }
  }
  const removed: EnemyId[] = prev.enemies.filter((e) => !enemiesAfter.has(e.id)).map((e) => e.id);

  return {
    type: 'tick',
    tick: next.tick,
    moved: moved.sort(byId),
    joined: joined.sort(byId),
    left: left.sort((a, b) => a - b),
    vitals: vitals.sort(byId),
    downed: [...next.downed].sort((a, b) => a - b),
    respawned: [...next.respawned].sort((a, b) => a - b),
    enemies: {
      spawned: spawned.sort(byId),
      moved: enemiesMoved.sort(byId),
      removed: removed.sort((a, b) => a - b),
      vitals: enemyVitals.sort(byId),
    },
    telegraphs: telegraphsOf(next),
    hits: next.hits.map(hitView),
  };
}

type Fields = Readonly<Record<string, unknown>>;

/** One kind of client message: its exact keys (sorted, `type` included) and how to check and build it. */
interface MessageSpec {
  readonly keys: readonly string[];
  readonly build: (fields: Fields, grid: Grid) => ClientMessage | null;
}

/** An id as a client may send it: the id pattern, at most `MAX_ID_LENGTH` characters. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

function isIdOrNull(value: unknown): value is string | null {
  return value === null || isId(value);
}

function isWholeNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isAttribute(value: unknown): value is Attribute {
  return typeof value === 'string' && (ATTRIBUTES as readonly string[]).includes(value);
}

/** A tile on the grid (a blocked one is still valid: the server routes to the nearest reachable one). */
function tileOf(fields: Fields, grid: Grid): { x: number; y: number } | null {
  const { x, y } = fields;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return inBounds(grid, { x, y }) ? { x, y } : null;
}

const CLIENT_MESSAGES: Readonly<Record<ClientMessage['type'], MessageSpec>> = {
  move: {
    keys: ['type', 'x', 'y'],
    build: (f, grid) => {
      const tile = tileOf(f, grid);
      return tile && { type: 'move', x: tile.x, y: tile.y };
    },
  },
  // Debug: running and riding get real rules later.
  mode: {
    keys: ['mode', 'type'],
    build: (f) => (isDebugMovementMode(f.mode) ? { type: 'mode', mode: f.mode } : null),
  },
  attack: {
    keys: ['enemyId', 'type'],
    build: (f) => (isWholeNumberIn(f.enemyId, 1, Number.MAX_SAFE_INTEGER) ? { type: 'attack', enemyId: f.enemyId } : null),
  },
  'attack-move': {
    keys: ['type', 'x', 'y'],
    build: (f, grid) => {
      const tile = tileOf(f, grid);
      return tile && { type: 'attack-move', x: tile.x, y: tile.y };
    },
  },
  'debug-preset': {
    keys: ['presetId', 'type'],
    build: (f) => (isId(f.presetId) ? { type: 'debug-preset', presetId: f.presetId } : null),
  },
  'debug-level': {
    keys: ['level', 'type'],
    build: (f) => (isWholeNumberIn(f.level, 1, MAX_LEVEL) ? { type: 'debug-level', level: f.level } : null),
  },
  'debug-move-point': {
    keys: ['from', 'to', 'type'],
    build: (f) => (isAttribute(f.from) && isAttribute(f.to) ? { type: 'debug-move-point', from: f.from, to: f.to } : null),
  },
  'debug-weapon': {
    keys: ['itemId', 'type'],
    build: (f) => (isIdOrNull(f.itemId) ? { type: 'debug-weapon', itemId: f.itemId } : null),
  },
  'debug-armor': {
    keys: ['itemId', 'type'],
    build: (f) => (isIdOrNull(f.itemId) ? { type: 'debug-armor', itemId: f.itemId } : null),
  },
  'debug-class-rank': {
    keys: ['classId', 'rank', 'type'],
    build: (f) =>
      isId(f.classId) && isWholeNumberIn(f.rank, 1, MAX_CLASS_RANK)
        ? { type: 'debug-class-rank', classId: f.classId, rank: f.rank }
        : null,
  },
  'debug-heal': { keys: ['type'], build: () => ({ type: 'debug-heal' }) },
  'debug-start-wave': {
    keys: ['type', 'waveId'],
    build: (f) => (isId(f.waveId) ? { type: 'debug-start-wave', waveId: f.waveId } : null),
  },
  'debug-clear-enemies': { keys: ['type'], build: () => ({ type: 'debug-clear-enemies' }) },
};

/**
 * Check a raw client message. Returns a fresh message, or null if it is too long, is not JSON, has
 * any key beyond the exact set for its type, or has a bad value. Coordinates are whole numbers inside
 * the grid (a blocked tile is still valid, as the server routes to the nearest reachable one); ids
 * match the id pattern and are at most 64 characters (whether they name anything is the server's
 * business: `"constructor"` parses); `level` is 1 to `MAX_LEVEL`, `rank` is 1 to `MAX_CLASS_RANK`,
 * attributes are from `ATTRIBUTES`, and `enemyId` is a positive whole number.
 */
export function parseClientMessage(raw: string, grid: Grid): ClientMessage | null {
  if (raw.length > MAX_CLIENT_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const fields = value as Fields;
  const type = fields.type;
  if (typeof type !== 'string' || !Object.hasOwn(CLIENT_MESSAGES, type)) return null;
  const spec = CLIENT_MESSAGES[type as ClientMessage['type']];
  const keys = Object.keys(value).sort();
  if (keys.length !== spec.keys.length || keys.some((k, i) => k !== spec.keys[i])) return null;
  return spec.build(fields, grid);
}
