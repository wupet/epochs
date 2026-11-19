/**
 * Route finding on the tile grid. Pure and deterministic: the server uses it to move characters
 * and the browser uses it for the hover preview, so both must get exactly the same path.
 */
import { STEP_DIRECTIONS, canStep, inBounds, sameTile } from './grid';
import type { Grid, Tile } from './grid';

export interface Route {
  /** The tile the route ends on: the target if it can be reached, else the nearest reachable tile. */
  readonly destination: Tile;
  /** The tiles to walk through, in order. Excludes the start; empty when already at the destination. */
  readonly path: readonly Tile[];
  /** True when `destination` is the tile that was asked for. */
  readonly reachedTarget: boolean;
}

/** How near two tiles are: squared distance. The one place "nearest" is defined. */
export function nearness(a: Tile, b: Tile): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Breadth-first step counts from `origin`, expanding to each neighbour that `canExpand` allows. -1 means unreached. */
function stepCounts(
  grid: Grid,
  origin: Tile,
  canExpand: (current: Tile, neighbour: Tile) => boolean,
): number[] {
  const steps: number[] = new Array<number>(grid.width * grid.height).fill(-1);
  steps[origin.y * grid.width + origin.x] = 0;
  const queue: Tile[] = [origin];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    const next = steps[current.y * grid.width + current.x]! + 1;
    for (const d of STEP_DIRECTIONS) {
      const neighbour = { x: current.x + d.x, y: current.y + d.y };
      if (!inBounds(grid, neighbour)) continue;
      const index = neighbour.y * grid.width + neighbour.x;
      if (steps[index] !== -1 || !canExpand(current, neighbour)) continue;
      steps[index] = next;
      queue.push(neighbour);
    }
  }
  return steps;
}

/**
 * Find the shortest route from `from` to `to`, one tile per step. If `to` cannot be reached (blocked,
 * walled off, or out of bounds), route to the reachable tile nearest to it instead. Ties on
 * nearness go to fewer steps, then lower y, then lower x. Among equally short paths, the one that
 * heads straight for the destination (diagonals first) wins.
 */
export function findRoute(grid: Grid, from: Tile, to: Tile): Route {
  // 1. Forward: how many steps to every tile reachable from `from`.
  const fromStart = stepCounts(grid, from, (current, neighbour) => canStep(grid, current, neighbour));

  // 2. Pick the destination.
  let destination: Tile = to;
  let reachedTarget = inBounds(grid, to) && fromStart[to.y * grid.width + to.x]! !== -1;
  if (!reachedTarget) {
    let best: Tile | undefined;
    let bestNearness = 0;
    let bestSteps = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const steps = fromStart[y * grid.width + x]!;
        if (steps === -1) continue;
        const tile = { x, y };
        const near = nearness(tile, to);
        // Scanning in y, then x order, so a strict comparison keeps the lower y, then lower x.
        if (best === undefined || near < bestNearness || (near === bestNearness && steps < bestSteps)) {
          best = tile;
          bestNearness = near;
          bestSteps = steps;
        }
      }
    }
    destination = best ?? from;
    reachedTarget = false;
  }

  // 3. Reverse: how many steps from every tile to the destination (walking the way a walker steps).
  const toDestination = stepCounts(grid, destination, (current, neighbour) =>
    canStep(grid, neighbour, current),
  );

  // 4. Walk from `from`, always taking a step that is one closer, preferring the straight line.
  const path: Tile[] = [];
  let current = from;
  while (!sameTile(current, destination)) {
    const remaining = toDestination[current.y * grid.width + current.x]!;
    if (remaining === -1) break; // `from` cannot be walked from: nowhere to go
    const preferred = {
      x: Math.sign(destination.x - current.x),
      y: Math.sign(destination.y - current.y),
    };
    let chosen: Tile | undefined;
    for (const d of [preferred, ...STEP_DIRECTIONS]) {
      const neighbour = { x: current.x + d.x, y: current.y + d.y };
      if (!inBounds(grid, neighbour) || !canStep(grid, current, neighbour)) continue;
      if (toDestination[neighbour.y * grid.width + neighbour.x] === remaining - 1) {
        chosen = neighbour;
        break;
      }
    }
    if (chosen === undefined) break; // cannot happen on a consistent grid
    path.push(chosen);
    current = chosen;
  }
  return { destination, path, reachedTarget };
}
