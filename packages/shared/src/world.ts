/**
 * The world state and `step`, the pure function the server calls every tick. The same state and the
 * same intentions always give the same next state: no randomness, no clock, no I/O. `step` never
 * changes the state it is given.
 */
import { STEP_DIRECTIONS, canStep, inBounds, isWalkable, sameTile } from './grid';
import type { Grid, Tile } from './grid';
import { findRoute } from './route';
import {
  DEBUG_MOVEMENT_MODES,
  DEFAULT_SPEED,
  MAX_STEPS_PER_TICK,
  STEP,
  isDebugMovementMode,
  restCap,
} from './movement';
import type { DebugMovementMode } from './movement';

/** A character's id: a positive integer from the server's counter, never reused. */
export type CharacterId = number;

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
}

export interface WorldState {
  readonly tick: number;
  readonly grid: Grid;
  /** Where new characters appear. */
  readonly spawn: Tile;
  /** Sorted by id, ascending. */
  readonly characters: readonly Character[];
}

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
  | { readonly kind: 'leave'; readonly characterId: CharacterId; readonly subtick: number };

/** A world at tick 0 with no characters. Throws if the spawn is not a walkable tile. */
export function createWorld(grid: Grid, spawn: Tile): WorldState {
  if (!isWalkable(grid, spawn)) {
    throw new Error(`The spawn (${spawn.x}, ${spawn.y}) is not a walkable tile.`);
  }
  return { tick: 0, grid, spawn, characters: [] };
}

/**
 * Where a character joining now should stand: the spawn if it is free, otherwise the nearest free
 * tile found by walking outward from the spawn (breadth-first, in STEP_DIRECTIONS order). If every
 * reachable tile is taken, the spawn: characters may share a tile.
 */
export function findSpawnTile(state: WorldState): Tile {
  const { grid, spawn, characters } = state;
  const isTaken = (tile: Tile): boolean => characters.some((c) => sameTile(c.tile, tile));
  const seen: boolean[] = new Array<boolean>(grid.width * grid.height).fill(false);
  seen[spawn.y * grid.width + spawn.x] = true;
  const queue: Tile[] = [spawn];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    if (!isTaken(current)) return current;
    for (const d of STEP_DIRECTIONS) {
      const neighbour = { x: current.x + d.x, y: current.y + d.y };
      if (!inBounds(grid, neighbour)) continue;
      const index = neighbour.y * grid.width + neighbour.x;
      if (seen[index] || !canStep(grid, current, neighbour)) continue;
      seen[index] = true;
      queue.push(neighbour);
    }
  }
  return spawn;
}

/**
 * Advance the world by one tick.
 *
 * 1. Sort the intentions by (subtick, characterId); ties keep their input order.
 * 2. Apply joins and leaves in that order.
 * 3. Give each character the last debug mode addressed to it as its speed (progress is kept).
 * 4. Give each character the last move addressed to it, as a route to its target.
 * 5. Move every character along its path: while it has a path, at least `STEP` of progress, and
 *    has taken fewer than `MAX_STEPS_PER_TICK` steps this tick, take the next step if it is still
 *    legal (else clear the path), paying `STEP`. Then add the speed to the progress; a character
 *    with no path left keeps at most `restCap(speed)`: one tick's worth of movement at its current
 *    speed (after this tick's mode change), never less than one step. Resting never banks free steps.
 * 6. Add one to the tick.
 */
export function step(state: WorldState, intentions: readonly Intention[]): WorldState {
  const sorted = [...intentions].sort(
    (a, b) => a.subtick - b.subtick || a.characterId - b.characterId,
  );

  // 2. Joins and leaves. `characters` is a private working copy, kept sorted by id.
  let characters: Character[] = [...state.characters];
  for (const intention of sorted) {
    if (intention.kind === 'join') {
      if (characters.some((c) => c.id === intention.characterId)) continue;
      const tile = findSpawnTile({ ...state, characters });
      characters.push({
        id: intention.characterId,
        tile,
        path: [],
        speed: DEFAULT_SPEED,
        progress: restCap(DEFAULT_SPEED),
        stepped: [],
      });
      characters.sort((a, b) => a.id - b.id);
    } else if (intention.kind === 'leave') {
      characters = characters.filter((c) => c.id !== intention.characterId);
    }
  }

  // 3. The last debug mode for each character wins. It changes the speed, not the progress.
  const lastMode = new Map<CharacterId, DebugMovementMode>();
  for (const intention of sorted) {
    if (intention.kind === 'mode' && isDebugMovementMode(intention.mode)) {
      lastMode.set(intention.characterId, intention.mode);
    }
  }
  characters = characters.map((c) => {
    const mode = lastMode.get(c.id);
    return mode === undefined ? c : { ...c, speed: DEBUG_MOVEMENT_MODES[mode] };
  });

  // 4. The last move for each character wins.
  const lastMove = new Map<CharacterId, Tile>();
  for (const intention of sorted) {
    if (intention.kind === 'move') lastMove.set(intention.characterId, intention.target);
  }
  characters = characters.map((c) => {
    const target = lastMove.get(c.id);
    return target === undefined ? c : { ...c, path: findRoute(state.grid, c.tile, target).path };
  });

  // 5. Movement: spend progress on steps, then earn this tick's progress.
  characters = characters.map((c) => {
    let { tile, path, progress } = c;
    const stepped: Tile[] = [];
    while (path.length > 0 && progress >= STEP && stepped.length < MAX_STEPS_PER_TICK) {
      const next = path[0]!;
      if (!canStep(state.grid, tile, next)) {
        path = [];
        break;
      }
      tile = next;
      path = path.slice(1);
      stepped.push(tile);
      progress -= STEP;
    }
    progress += c.speed;
    if (path.length === 0) progress = Math.min(progress, restCap(c.speed));
    return { id: c.id, tile, path, speed: c.speed, progress, stepped };
  });

  return { tick: state.tick + 1, grid: state.grid, spawn: state.spawn, characters };
}
