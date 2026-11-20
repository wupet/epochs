/**
 * Waves (debug): starting one places its enemies, clearing the old ones first. Pure. A wave's
 * enemies come from content; each one appears on the nearest free tile to the one the wave gives it,
 * so an enemy never shares a tile with a player or another enemy.
 */
import { STEP_DIRECTIONS, canStep, inBounds, isWalkable, sameTile } from './grid';
import type { Grid, Tile } from './grid';
import { lookup } from './content/bundle';
import { restCap } from './movement';
import type { Enemy, WorldState } from './world';

/**
 * The nearest tile to `from` that `isTaken` says is free: `from` itself if it is, otherwise the first
 * free tile found walking outward (breadth-first over legal steps, in STEP_DIRECTIONS order). Null if
 * `from` is not walkable, or every tile reachable from it is taken.
 */
export function nearestFreeTile(grid: Grid, from: Tile, isTaken: (tile: Tile) => boolean): Tile | null {
  if (!isWalkable(grid, from)) return null;
  const seen: boolean[] = new Array<boolean>(grid.width * grid.height).fill(false);
  seen[from.y * grid.width + from.x] = true;
  const queue: Tile[] = [from];
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
  return null;
}

/** The world with no enemies. Enemy ids keep counting from `nextEnemyId`; they are never reused. */
export function clearEnemies(state: WorldState): WorldState {
  return { ...state, enemies: [] };
}

/**
 * Starts a wave (debug): clears the enemies, then places the wave's enemies in order, each on the
 * nearest tile free of players and of the enemies placed before it, with ids from `nextEnemyId`.
 * An enemy whose content id is unknown, or that finds no free tile, is skipped. An unknown wave id
 * (including inherited names like "constructor") returns the same state.
 */
export function startWave(state: WorldState, waveId: string): WorldState {
  const wave = lookup(state.content.waves, waveId);
  if (!wave) return state;
  const enemies: Enemy[] = [];
  let nextEnemyId = state.nextEnemyId;
  const isTaken = (tile: Tile): boolean =>
    state.characters.some((c) => sameTile(c.tile, tile)) || enemies.some((e) => sameTile(e.tile, tile));
  for (const entry of wave.enemies) {
    const content = lookup(state.content.enemies, entry.enemy);
    if (!content) continue;
    const tile = nearestFreeTile(state.grid, { x: entry.x, y: entry.y }, isTaken);
    if (tile === null) continue;
    enemies.push({
      id: nextEnemyId++,
      contentId: content.id,
      tile,
      path: [],
      speed: content.speed,
      progress: restCap(content.speed),
      stepped: [],
      health: content.health,
      lastDamagedBy: null,
      lastHitTick: null,
      windup: null,
      readyTick: state.tick,
    });
  }
  return { ...state, enemies, nextEnemyId };
}
