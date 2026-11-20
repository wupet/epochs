/**
 * The world state and `step`, the pure function the server calls every tick. The same state and the
 * same intentions always give the same next state: no clock, no I/O, and randomness only from the
 * seeded generator state `rng`. `step` never changes the state it is given.
 */
import { gridFromRows, isWalkable, sameTile, withBlockers } from './grid';
import type { Grid, Tile } from './grid';
import { findRoute } from './route';
import { DEBUG_MOVEMENT_MODES, DEFAULT_SPEED, isDebugMovementMode, restCap } from './movement';
import type { DebugMovementMode } from './movement';
import { EMPTY_CONTENT, lookup } from './content/bundle';
import type { ContentBundle } from './content/bundle';
import type { Attribute } from './content/vocabulary';
import { applyPreset, maxHealthOf, movePoint, newSheet, setArmor, setClassRank, setLevel, setWeapon } from './character';
import type { PlayerSheet } from './character';
import { walk } from './walking';
import { clearEnemies, nearestFreeTile, startWave } from './waves';

/** A character's id: a positive integer from the server's counter, never reused. */
export type CharacterId = number;

/** An enemy's id: a positive integer from `WorldState.nextEnemyId`, never reused. */
export type EnemyId = number;

/** Who did something: a player character or an enemy. */
export interface Ref {
  readonly side: 'player' | 'enemy';
  readonly id: number;
}

/** What a player is doing. Never sent to clients. */
export type Order =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly destination: Tile }
  | { readonly kind: 'attack'; readonly enemyId: EnemyId }
  | { readonly kind: 'attack-move'; readonly destination: Tile; readonly lockedOn: EnemyId | null };

/** One hit taken or dealt, as this tick's events and a player's recent hits record it. */
export interface Hit {
  readonly tick: number;
  readonly attacker: Ref;
  readonly target: Ref;
  readonly amount: number;
  readonly attackerName: string;
  readonly attackName: string;
  /** The telegraph the target was standing in, if the hit came from one. */
  readonly telegraph: { readonly name: string; readonly windupTicks: number } | null;
}

/** A player's death recap: the last hits they took before going down. */
export interface Recap {
  readonly characterId: CharacterId;
  readonly tick: number;
  readonly hits: readonly Hit[];
}

export interface Character {
  readonly id: CharacterId;
  readonly tile: Tile;
  /** The tiles still to walk through, in order. Empty when standing still. Never sent to clients. */
  readonly path: readonly Tile[];
  /** Millitiles of progress gained per tick. At most `MAX_SPEED`. */
  readonly speed: number;
  /** Millitiles built up toward the next step. A step costs `STEP`. Never sent to clients. */
  readonly progress: number;
  /** The tiles entered this tick, in order. Empty if the character did not move. */
  readonly stepped: readonly Tile[];
  readonly health: number;
  /** Only the owner ever sees their sheet. */
  readonly sheet: PlayerSheet;
  /** Never sent to clients. */
  readonly order: Order;
  /** The first tick the next basic attack may land on. Never sent to clients. */
  readonly nextAttackTick: number;
  /** The last hits taken, for the death recap. Never sent to clients except in the owner's recap. */
  readonly recentHits: readonly Hit[];
}

/** An attack being wound up: it lands on `tiles` on tick `resolvesAt`. */
export interface Windup {
  readonly attackId: string;
  readonly tiles: readonly Tile[];
  readonly resolvesAt: number;
}

export interface Enemy {
  readonly id: EnemyId;
  /** Its id in `content.enemies`. */
  readonly contentId: string;
  readonly tile: Tile;
  /** Never sent to clients. */
  readonly path: readonly Tile[];
  readonly speed: number;
  /** Never sent to clients. */
  readonly progress: number;
  readonly stepped: readonly Tile[];
  readonly health: number;
  /** The player who most recently damaged it. Never sent to clients. */
  readonly lastDamagedBy: CharacterId | null;
  /** The tick it was last damaged on (the dummy heals 20 ticks later). Never sent to clients. */
  readonly lastHitTick: number | null;
  readonly windup: Windup | null;
  /** The first tick it may start an attack on. Never sent to clients. */
  readonly readyTick: number;
}

export interface WorldState {
  readonly tick: number;
  readonly grid: Grid;
  /** Where new characters appear. */
  readonly spawn: Tile;
  /** Sorted by id, ascending. */
  readonly characters: readonly Character[];
  /** Sorted by id, ascending. */
  readonly enemies: readonly Enemy[];
  /** The campfire tile (blocked), or null. */
  readonly campfire: Tile | null;
  /** The checked content, read-only. */
  readonly content: ContentBundle;
  /** The preset a joining player gets, or null for none. */
  readonly startingPresetId: string | null;
  /** The seeded generator's 32-bit state. Never sent to clients. */
  readonly rng: number;
  readonly nextEnemyId: EnemyId;
  /** This tick's events, rebuilt every tick. */
  readonly hits: readonly Hit[];
  readonly downed: readonly CharacterId[];
  readonly respawned: readonly CharacterId[];
  readonly recaps: readonly Recap[];
}

/** What a new world is made from, besides its grid and spawn. */
export interface WorldSetup {
  readonly content: ContentBundle;
  readonly seed: number;
  readonly campfire: Tile | null;
  readonly startingPresetId: string | null;
}

/**
 * Debug intentions: they change your own sheet or health, or start and clear waves. Every one that
 * changes your sheet heals you to full (builder's call 13). An unknown id, or an item of the wrong
 * kind, does nothing.
 */
export type DebugIntention =
  | { readonly kind: 'debug-preset'; readonly characterId: CharacterId; readonly presetId: string; readonly subtick: number }
  | { readonly kind: 'debug-level'; readonly characterId: CharacterId; readonly level: number; readonly subtick: number }
  | {
      readonly kind: 'debug-move-point';
      readonly characterId: CharacterId;
      readonly from: Attribute;
      readonly to: Attribute;
      readonly subtick: number;
    }
  | { readonly kind: 'debug-weapon'; readonly characterId: CharacterId; readonly itemId: string | null; readonly subtick: number }
  | { readonly kind: 'debug-armor'; readonly characterId: CharacterId; readonly itemId: string | null; readonly subtick: number }
  | {
      readonly kind: 'debug-class-rank';
      readonly characterId: CharacterId;
      readonly classId: string;
      readonly rank: number;
      readonly subtick: number;
    }
  | { readonly kind: 'debug-heal'; readonly characterId: CharacterId; readonly subtick: number }
  | { readonly kind: 'debug-start-wave'; readonly characterId: CharacterId; readonly waveId: string; readonly subtick: number }
  | { readonly kind: 'debug-clear-enemies'; readonly characterId: CharacterId; readonly subtick: number };

/**
 * What a client (or the server on its behalf) asks for. `subtick` orders intentions within a tick;
 * it is 0 in Phase 0. A move is a wish to walk to `target`, not a result.
 * A `mode` sets the movement speed to one of the debug modes.
 */
export type Intention =
  | { readonly kind: 'move'; readonly characterId: CharacterId; readonly target: Tile; readonly subtick: number }
  // Debug: running and riding get real rules later.
  | { readonly kind: 'mode'; readonly characterId: CharacterId; readonly mode: DebugMovementMode; readonly subtick: number }
  | { readonly kind: 'join'; readonly characterId: CharacterId; readonly subtick: number }
  | { readonly kind: 'leave'; readonly characterId: CharacterId; readonly subtick: number }
  | DebugIntention;

/**
 * A world at tick 0 with no characters and no enemies. Throws if the spawn is not a walkable tile.
 * Defaults: no content, seed 1, no campfire, no starting preset.
 */
export function createWorld(grid: Grid, spawn: Tile, setup: Partial<WorldSetup> = {}): WorldState {
  if (!isWalkable(grid, spawn)) {
    throw new Error(`The spawn (${spawn.x}, ${spawn.y}) is not a walkable tile.`);
  }
  return {
    tick: 0,
    grid,
    spawn,
    characters: [],
    enemies: [],
    campfire: setup.campfire ?? null,
    content: setup.content ?? EMPTY_CONTENT,
    startingPresetId: setup.startingPresetId ?? null,
    rng: (setup.seed ?? 1) >>> 0,
    nextEnemyId: 1,
    hits: [],
    downed: [],
    respawned: [],
    recaps: [],
  };
}

/** A world on an arena from the content, with its campfire tile blocked. Throws on an unknown arena. */
export function createArenaWorld(content: ContentBundle, arenaId: string, seed: number): WorldState {
  const arena = lookup(content.arenas, arenaId);
  if (!arena) throw new Error(`No arena with id "${arenaId}".`);
  const grid = withBlockers(gridFromRows(arena.rows), [arena.campfire]);
  return createWorld(grid, arena.spawn, {
    content,
    seed,
    campfire: arena.campfire,
    startingPresetId: arena.startingPreset,
  });
}

/**
 * Where a character joining now should stand: the spawn if it is free, otherwise the nearest tile
 * free of characters and enemies (see `nearestFreeTile`). If every reachable tile is taken, the
 * spawn: characters may share a tile.
 */
export function findSpawnTile(state: WorldState): Tile {
  const taken = [...state.characters, ...state.enemies].map((c) => c.tile);
  return nearestFreeTile(state.grid, state.spawn, (tile) => taken.some((t) => sameTile(t, tile))) ?? state.spawn;
}

/**
 * Advance the world by one tick (the spec's "One tick"; the phases not yet built are skipped).
 *
 * 1. Sort the intentions by (subtick, characterId); ties keep their input order. Clear the events.
 * 2. Joins and leaves.
 * 3. Debug intentions, one after another.
 * 4. Movement modes: the last debug mode for each character sets its speed (progress is kept).
 * 5. Orders: the last move for each character becomes its order, routed around the enemies.
 * 8. Movement: players in id order, then enemies in id order, each walking (see `walk`) against
 *    blockers that reflect where everyone has already moved this tick. A move order ends when its
 *    path runs out.
 * 12. Add one to the tick.
 */
export function step(state: WorldState, intentions: readonly Intention[]): WorldState {
  const sorted = [...intentions].sort((a, b) => a.subtick - b.subtick || a.characterId - b.characterId);
  let next: WorldState = { ...state, hits: [], downed: [], respawned: [], recaps: [] };
  next = applyJoinsAndLeaves(next, sorted);
  next = applyDebugIntentions(next, sorted);
  next = applyModes(next, sorted);
  next = applyOrders(next, sorted);
  next = moveEveryone(next);
  return { ...next, tick: state.tick + 1 };
}

/** A copy of the state with one character replaced by `change(character)`. */
function updateCharacter(state: WorldState, id: CharacterId, change: (c: Character) => Character): WorldState {
  return { ...state, characters: state.characters.map((c) => (c.id === id ? change(c) : c)) };
}

/** 2. Joins and leaves, in order. A joiner gets the starting preset, at level 1 and full health. */
function applyJoinsAndLeaves(state: WorldState, sorted: readonly Intention[]): WorldState {
  let next = state;
  for (const intention of sorted) {
    if (intention.kind === 'join') {
      if (next.characters.some((c) => c.id === intention.characterId)) continue;
      const sheet = newSheet(next.content, next.startingPresetId);
      const joiner: Character = {
        id: intention.characterId,
        tile: findSpawnTile(next),
        path: [],
        speed: DEFAULT_SPEED,
        progress: restCap(DEFAULT_SPEED),
        stepped: [],
        health: maxHealthOf(sheet, next.content),
        sheet,
        order: { kind: 'none' },
        nextAttackTick: 0,
        recentHits: [],
      };
      next = { ...next, characters: [...next.characters, joiner].sort((a, b) => a.id - b.id) };
    } else if (intention.kind === 'leave') {
      next = { ...next, characters: next.characters.filter((c) => c.id !== intention.characterId) };
    }
  }
  return next;
}

const DEBUG_INTENTION_KINDS: readonly string[] = [
  'debug-preset',
  'debug-level',
  'debug-move-point',
  'debug-weapon',
  'debug-armor',
  'debug-class-rank',
  'debug-heal',
  'debug-start-wave',
  'debug-clear-enemies',
] satisfies readonly DebugIntention['kind'][];

/** True only for the nine debug kinds; anything else (an unknown `debug-…` name, a non-string) is not one. */
function isDebugIntention(intention: Intention): intention is DebugIntention {
  return DEBUG_INTENTION_KINDS.includes(intention.kind);
}

/** 3. Debug intentions, one after another. One from a character not in the world does nothing. */
function applyDebugIntentions(state: WorldState, sorted: readonly Intention[]): WorldState {
  let next = state;
  for (const intention of sorted) {
    if (!isDebugIntention(intention)) continue;
    if (!next.characters.some((c) => c.id === intention.characterId)) continue;
    next = applyDebugIntention(next, intention);
  }
  return next;
}

function applyDebugIntention(state: WorldState, intention: DebugIntention): WorldState {
  const { content } = state;
  const sender = intention.characterId;
  switch (intention.kind) {
    case 'debug-preset':
      return changeSheet(state, sender, (sheet) => applyPreset(sheet, content, intention.presetId));
    case 'debug-level':
      return changeSheet(state, sender, (sheet) => setLevel(sheet, content, intention.level));
    case 'debug-move-point':
      return changeSheet(state, sender, (sheet) => movePoint(sheet, intention.from, intention.to));
    case 'debug-weapon':
      return changeSheet(state, sender, (sheet) => setWeapon(sheet, content, intention.itemId));
    case 'debug-armor':
      return changeSheet(state, sender, (sheet) => setArmor(sheet, content, intention.itemId));
    case 'debug-class-rank':
      return changeSheet(state, sender, (sheet) => setClassRank(sheet, content, intention.classId, intention.rank));
    case 'debug-heal':
      return updateCharacter(state, sender, (c) => ({ ...c, health: maxHealthOf(c.sheet, content) }));
    case 'debug-start-wave':
      return startWave(state, intention.waveId);
    case 'debug-clear-enemies':
      return clearEnemies(state);
  }
}

/**
 * Applies a sheet setter to one character. If the setter changed the sheet, the character heals to
 * the new max health (builder's call 13); if it returned the same sheet (an invalid request), nothing
 * changes at all.
 */
function changeSheet(state: WorldState, id: CharacterId, change: (sheet: PlayerSheet) => PlayerSheet): WorldState {
  return updateCharacter(state, id, (c) => {
    const sheet = change(c.sheet);
    return sheet === c.sheet ? c : { ...c, sheet, health: maxHealthOf(sheet, state.content) };
  });
}

/** 4. The last debug mode for each character wins. It changes the speed, not the progress. */
function applyModes(state: WorldState, sorted: readonly Intention[]): WorldState {
  const lastMode = new Map<CharacterId, DebugMovementMode>();
  for (const intention of sorted) {
    if (intention.kind === 'mode' && isDebugMovementMode(intention.mode)) {
      lastMode.set(intention.characterId, intention.mode);
    }
  }
  if (lastMode.size === 0) return state;
  return {
    ...state,
    characters: state.characters.map((c) => {
      const mode = lastMode.get(c.id);
      return mode === undefined ? c : { ...c, speed: DEBUG_MOVEMENT_MODES[mode] };
    }),
  };
}

/** 5. The last move for each character wins: a move order, routed around the enemies. */
function applyOrders(state: WorldState, sorted: readonly Intention[]): WorldState {
  const lastMove = new Map<CharacterId, Tile>();
  for (const intention of sorted) {
    if (intention.kind === 'move') lastMove.set(intention.characterId, intention.target);
  }
  if (lastMove.size === 0) return state;
  const blockers = withBlockers(state.grid, state.enemies.map((e) => e.tile));
  return {
    ...state,
    characters: state.characters.map((c) => {
      const destination = lastMove.get(c.id);
      if (destination === undefined) return c;
      return { ...c, order: { kind: 'move', destination }, path: findRoute(blockers, c.tile, destination).path };
    }),
  };
}

/** Where a mover is headed: its move order's destination, else the end of its path, else nowhere. */
function destinationOf(mover: { readonly path: readonly Tile[]; readonly order?: Order }): Tile | undefined {
  if (mover.order?.kind === 'move') return mover.order.destination;
  return mover.path[mover.path.length - 1];
}

/** A re-route for `walk`: a fresh route to the destination on the blockers grid, or none. */
function rerouteToward(blockers: Grid, destination: Tile | undefined): (from: Tile) => readonly Tile[] {
  return (from) => (destination === undefined ? [] : findRoute(blockers, from, destination).path);
}

/**
 * 8. Movement. Players first, in id order: enemies block them, other players don't. Then enemies,
 * in id order: players and the other enemies block them, where they stand after moving this tick.
 */
function moveEveryone(state: WorldState): WorldState {
  const terrain = state.grid;
  const playerBlockers = withBlockers(terrain, state.enemies.map((e) => e.tile));
  const characters = state.characters.map((c) => {
    const moved = walk(c, playerBlockers, terrain, rerouteToward(playerBlockers, destinationOf(c)));
    return moved.order.kind === 'move' && moved.path.length === 0 ? { ...moved, order: { kind: 'none' } as const } : moved;
  });
  const enemies = [...state.enemies];
  enemies.forEach((enemy, i) => {
    const occupied = [...characters.map((c) => c.tile), ...enemies.filter((_, j) => j !== i).map((e) => e.tile)];
    const blockers = withBlockers(terrain, occupied);
    enemies[i] = walk(enemy, blockers, terrain, rerouteToward(blockers, destinationOf(enemy)));
  });
  return { ...state, characters, enemies };
}
