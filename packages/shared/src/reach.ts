/**
 * Who can hit whom: melee strikes, line of sight and ranged reach. Terrain only: characters never
 * block a strike or a shot. Pure.
 */
import { inBounds, isWalkable } from './grid';
import type { Grid, Tile } from './grid';
import { nearness } from './route';

/**
 * A melee strike (range 1): the target is a neighbouring tile, and for a diagonal, both tiles
 * between are open terrain (the corner rule of `canStep`, terrain only).
 */
export function canStrike(grid: Grid, from: Tile, to: Tile): boolean {
  if (!inBounds(grid, from) || !inBounds(grid, to)) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  if (dx !== 0 && dy !== 0) {
    return isWalkable(grid, { x: to.x, y: from.y }) && isWalkable(grid, { x: from.x, y: to.y });
  }
  return true;
}

/**
 * Whether the straight segment between two tile centres passes only through open tiles. A tile the
 * segment touches only at a corner counts, and when the segment goes exactly through a corner, both
 * tiles beside it count. The two end tiles are not checked.
 *
 * Walks the segment in whole numbers (a supercover): with `nx` and `ny` the steps across and down,
 * after `ix` column crossings and `iy` row crossings the segment is at (ix + 1/2) / nx of the way
 * to the next column edge and (iy + 1/2) / ny to the next row edge; comparing the two says which edge
 * comes first, and equal means a corner.
 */
export function hasLineOfSight(grid: Grid, from: Tile, to: Tile): boolean {
  if (!inBounds(grid, from) || !inBounds(grid, to)) return false;
  const nx = Math.abs(to.x - from.x);
  const ny = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  let ix = 0;
  let iy = 0;
  while (ix < nx || iy < ny) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      // Exactly through a corner: both tiles beside it are touched.
      if (!isWalkable(grid, { x: x + sx, y }) || !isWalkable(grid, { x, y: y + sy })) return false;
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    if (ix === nx && iy === ny) break; // the end tile is not checked
    if (!isWalkable(grid, { x, y })) return false;
  }
  return true;
}

/**
 * Whether a weapon of this range can hit from one tile to another. Range 1 is a melee strike;
 * anything longer needs the target within that many tiles (a diagonal tile is 1 away, as in movement)
 * and a clear line of sight.
 */
export function inReach(grid: Grid, from: Tile, to: Tile, rangeTiles: number): boolean {
  if (rangeTiles <= 1) return canStrike(grid, from, to);
  return nearness(from, to) <= rangeTiles && hasLineOfSight(grid, from, to);
}
