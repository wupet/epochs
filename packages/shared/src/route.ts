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

/** How far (in tiles) from the clicked tile the search for the nearest reachable tile looks. About one screen. */
export const NEAREST_SEARCH_RADIUS = 16;

/** How near two tiles are: the Chebyshev distance, so a diagonal tile is 1 away. The one place "nearest" is defined. */
export function nearness(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Breadth-first step counts from `origin`, expanding to each neighbour that `canExpand` allows.
 * `steps` is -1 for unreached tiles; `order` lists the reached tiles in the order they were found,
 * which is increasing step count.
 */
function stepCounts(
  grid: Grid,
  origin: Tile,
  canExpand: (current: Tile, neighbour: Tile) => boolean,
): { steps: number[]; order: Tile[] } {
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
  return { steps, order: queue };
}

/**
 * Find the shortest route from `from` to `to`, one tile per step. If `to` cannot be reached (blocked,
 * walled off, or out of bounds), route to the reachable tile nearest to it instead, looking only within
 * `NEAREST_SEARCH_RADIUS` tiles of `to` (with none in range, stay put). Nearness is the Chebyshev distance;
 * ties go to fewer steps, then lower y, then lower x. Among equally short paths, the one with the least
 * total deviation from the straight line between `from` and the destination wins; remaining ties go to
 * the first step in `STEP_DIRECTIONS` order. Integer arithmetic only, so the result is exact.
 */
export function findRoute(grid: Grid, from: Tile, to: Tile): Route {
  // 1. Forward: how many steps to every tile reachable from `from`.
  const fromStart = stepCounts(grid, from, (current, neighbour) => canStep(grid, current, neighbour)).steps;

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
        if (near > NEAREST_SEARCH_RADIUS) continue;
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
  const reverse = stepCounts(grid, destination, (current, neighbour) => canStep(grid, neighbour, current));
  const toDestination = reverse.steps;

  // 4. Cost of the best path from every tile: the least total deviation from the straight line
  // from `from` to `destination`, over shortest paths only. Processed in increasing step count.
  const dx = destination.x - from.x;
  const dy = destination.y - from.y;
  const deviation = (p: Tile): number => Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx);
  const cost: number[] = new Array<number>(grid.width * grid.height).fill(-1);
  /** The successors of `tile`: steps it can take that are one closer to the destination, in STEP_DIRECTIONS order. */
  const successors = (tile: Tile, remaining: number): Tile[] => {
    const result: Tile[] = [];
    for (const d of STEP_DIRECTIONS) {
      const neighbour = { x: tile.x + d.x, y: tile.y + d.y };
      if (!inBounds(grid, neighbour) || !canStep(grid, tile, neighbour)) continue;
      if (toDestination[neighbour.y * grid.width + neighbour.x] === remaining - 1) result.push(neighbour);
    }
    return result;
  };
  for (const tile of reverse.order) {
    const index = tile.y * grid.width + tile.x;
    const remaining = toDestination[index]!;
    if (remaining === 0) {
      cost[index] = deviation(tile);
      continue;
    }
    let least = -1;
    for (const next of successors(tile, remaining)) {
      const c = cost[next.y * grid.width + next.x]!;
      if (least === -1 || c < least) least = c;
    }
    cost[index] = least === -1 ? -1 : deviation(tile) + least;
  }

  // 5. Walk from `from`, taking the successor with the least cost; ties go to the first in STEP_DIRECTIONS order.
  const path: Tile[] = [];
  let current = from;
  while (!sameTile(current, destination)) {
    const remaining = toDestination[current.y * grid.width + current.x]!;
    // Defensive and unreachable for an in-bounds start: the reverse search reaches every tile the forward
    // search did, and the destination is one of those. (A blocked `from` can still get a reverse distance.)
    if (remaining === -1) break;
    let chosen: Tile | undefined;
    let chosenCost = 0;
    for (const next of successors(current, remaining)) {
      const c = cost[next.y * grid.width + next.x]!;
      if (chosen === undefined || c < chosenCost) {
        chosen = next;
        chosenCost = c;
      }
    }
    if (chosen === undefined) break; // defensive: some neighbour is always one step closer
    path.push(chosen);
    current = chosen;
  }
  return { destination, path, reachedTarget };
}
