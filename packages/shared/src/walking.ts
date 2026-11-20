/**
 * Walking one mover (a player or an enemy) along its path for one tick. Pure: the caller supplies
 * the blockers and the re-route, so the same rule serves everyone.
 */
import { canStep } from './grid';
import type { Grid, Tile } from './grid';
import { MAX_STEPS_PER_TICK, STEP, restCap } from './movement';

/** The fields a mover walks with. */
export interface Walker {
  readonly tile: Tile;
  /** The tiles still to walk through, in order. Empty when standing still. Never sent to clients. */
  readonly path: readonly Tile[];
  /** Millitiles of progress gained per tick. At most `MAX_SPEED`. */
  readonly speed: number;
  /** Millitiles built up toward the next step. A step costs `STEP`. Never sent to clients. */
  readonly progress: number;
  /** The tiles entered this tick, in order. Empty if the mover did not move. */
  readonly stepped: readonly Tile[];
}

/**
 * One tick of walking (the 0.2.1 rules, plus the spec's builder's call 7):
 *
 * - While the mover has a path, at least `STEP` of progress, and has taken fewer than
 *   `MAX_STEPS_PER_TICK` steps this tick, it takes the next step and pays `STEP`.
 * - A next step that is illegal on the `terrain` (a stale path) clears the path.
 * - A next step that is legal on the terrain but not on `blockers` (an occupied tile, or a diagonal
 *   squeezing past one) asks `reroute(from)` for a new path, once per tick. If that path's first step
 *   is legal, the mover takes it. Otherwise the mover waits this tick and keeps its old path, to try
 *   again next tick.
 * - Then it adds its speed to its progress. A mover with no path left, or one that waited, keeps at
 *   most `restCap(speed)`: standing or waiting never banks free steps.
 */
export function walk<T extends Walker>(
  mover: T,
  blockers: Grid,
  terrain: Grid,
  reroute: (from: Tile) => readonly Tile[],
): T {
  let { tile, path, progress } = mover;
  const stepped: Tile[] = [];
  let rerouted = false;
  let waited = false;
  while (path.length > 0 && progress >= STEP && stepped.length < MAX_STEPS_PER_TICK) {
    let next = path[0]!;
    if (!canStep(terrain, tile, next)) {
      path = [];
      break;
    }
    if (!canStep(blockers, tile, next)) {
      const fresh = rerouted ? [] : reroute(tile);
      rerouted = true;
      const first = fresh[0];
      if (first === undefined || !canStep(blockers, tile, first)) {
        waited = true;
        break;
      }
      path = fresh;
      next = first;
    }
    tile = next;
    path = path.slice(1);
    stepped.push(tile);
    progress -= STEP;
  }
  progress += mover.speed;
  if (path.length === 0 || waited) progress = Math.min(progress, restCap(mover.speed));
  return { ...mover, tile, path, progress, stepped };
}
