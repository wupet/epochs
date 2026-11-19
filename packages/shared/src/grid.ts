/**
 * The tile grid and the rules for stepping on it. Pure: no randomness, no clock, no I/O.
 */

/** One square of the grid. x grows to the right, y grows downward. */
export interface Tile {
  readonly x: number;
  readonly y: number;
}

/**
 * Width, height, and which tiles are blocked. Blocked tiles are a flat array, index
 * `y * width + x`, never a Set (a Set would vanish when serialized to JSON).
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly blocked: readonly boolean[];
}

/** The eight directions of a step: N, E, S, W, NE, SE, SW, NW, as tile deltas. y grows downward. */
export const STEP_DIRECTIONS: readonly Tile[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Build a grid from rows of text: '#' is blocked, '.' is open. Throws on a bad shape or character. */
export function gridFromRows(rows: readonly string[]): Grid {
  const height = rows.length;
  const width = height === 0 ? 0 : rows[0]!.length;
  if (width === 0 || height === 0) {
    throw new Error('A grid needs at least one row and one column.');
  }
  const blocked: boolean[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`Row ${y} has ${row.length} tiles, but row 0 has ${width}.`);
    }
    for (let x = 0; x < width; x++) {
      const char = row[x];
      if (char === '#') blocked.push(true);
      else if (char === '.') blocked.push(false);
      else throw new Error(`Unknown tile '${char}' at (${x}, ${y}). Use '#' or '.'.`);
    }
  });
  return { width, height, blocked };
}

/** The inverse of `gridFromRows`. */
export function gridToRows(grid: Grid): string[] {
  const rows: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let row = '';
    for (let x = 0; x < grid.width; x++) {
      row += grid.blocked[y * grid.width + x] ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

export function inBounds(grid: Grid, tile: Tile): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < grid.width && tile.y < grid.height;
}

/** A tile is walkable if it is in bounds and not blocked. */
export function isWalkable(grid: Grid, tile: Tile): boolean {
  return inBounds(grid, tile) && !grid.blocked[tile.y * grid.width + tile.x];
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Whether a character may step from one tile to another in one tick. The tiles must be
 * neighbours (8 directions), and `to` must be walkable. A diagonal step also needs both tiles
 * you would pass between to be walkable: no cutting corners (Old School RuneScape's rule).
 */
export function canStep(grid: Grid, from: Tile, to: Tile): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return false;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (!isWalkable(grid, to)) return false;
  if (dx !== 0 && dy !== 0) {
    return isWalkable(grid, { x: to.x, y: from.y }) && isWalkable(grid, { x: from.x, y: to.y });
  }
  return true;
}
