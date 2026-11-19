import { describe, expect, it } from 'vitest';
import { canStep, findRoute, gridFromRows, nearness, sameTile } from './index';
import type { Grid, Route, Tile } from './index';

const ROW_WALL = ['.....', '.....', '.###.', '.....', '.....'];
const COLUMN_WALL = ['.....', '..#..', '..#..', '..#..'];

function open(width: number, height: number): Grid {
  return gridFromRows(Array.from({ length: height }, () => '.'.repeat(width)));
}

function t(x: number, y: number): Tile {
  return { x, y };
}

/** Run findRoute and check that every consecutive pair (starting at `from`) satisfies canStep. */
function route(grid: Grid, from: Tile, to: Tile): Route {
  const result = findRoute(grid, from, to);
  let previous = from;
  for (const tile of result.path) {
    expect(canStep(grid, previous, tile)).toBe(true);
    previous = tile;
  }
  expect(sameTile(previous, result.destination)).toBe(true);
  return result;
}

describe('nearness', () => {
  it('is the squared distance', () => {
    expect(nearness(t(0, 0), t(3, 4))).toBe(25);
    expect(nearness(t(2, 2), t(2, 2))).toBe(0);
    expect(nearness(t(-1, 0), t(1, 0))).toBe(4);
  });
});

describe('findRoute on an open grid', () => {
  const grid = open(5, 5);

  it('steps diagonally first', () => {
    const r = route(grid, t(0, 0), t(3, 1));
    expect(r.path).toEqual([t(1, 1), t(2, 1), t(3, 1)]);
    expect(r.reachedTarget).toBe(true);
    expect(r.destination).toEqual(t(3, 1));
  });

  it('steps diagonally first when the target is mostly vertical', () => {
    expect(route(grid, t(0, 0), t(1, 3)).path).toEqual([t(1, 1), t(1, 2), t(1, 3)]);
  });

  it('takes as many steps as the Chebyshev distance', () => {
    expect(route(grid, t(0, 0), t(4, 2)).path).toHaveLength(4);
  });

  it('is empty when already at the destination', () => {
    const r = route(grid, t(2, 2), t(2, 2));
    expect(r.path).toEqual([]);
    expect(r.reachedTarget).toBe(true);
    expect(r.destination).toEqual(t(2, 2));
  });

  it('is deterministic', () => {
    expect(findRoute(grid, t(0, 0), t(4, 3))).toEqual(findRoute(grid, t(0, 0), t(4, 3)));
  });
});

describe('findRoute around obstacles', () => {
  it('passes through the gap in a wall and never steps on a blocked tile', () => {
    const grid = gridFromRows(['..#..', '..#..', '.....', '..#..', '..#..']);
    const r = route(grid, t(0, 0), t(4, 0));
    expect(r.reachedTarget).toBe(true);
    expect(r.path.some((tile) => tile.x === 2 && tile.y === 2)).toBe(true);
    for (const tile of r.path) expect(grid.blocked[tile.y * grid.width + tile.x]).toBe(false);
  });

  it('does not cut corners', () => {
    const grid = gridFromRows(['.#', '#.']);
    const r = route(grid, t(0, 0), t(1, 1));
    expect(r.reachedTarget).toBe(false);
    expect(r.destination).toEqual(t(0, 0));
    expect(r.path).toEqual([]);
  });
});

describe('findRoute when the target cannot be reached', () => {
  it('goes to the neighbour of a blocked target', () => {
    const grid = gridFromRows(['.....', '.....', '..#..', '.....', '.....']);
    const r = route(grid, t(0, 2), t(2, 2));
    expect(r.reachedTarget).toBe(false);
    expect(r.destination).toEqual(t(1, 2));
    expect(r.path[r.path.length - 1]).toEqual(t(1, 2));
  });

  it('goes to the nearest outside tile for a target in a closed room', () => {
    const grid = gridFromRows([
      '.......',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    const r = route(grid, t(0, 0), t(3, 3));
    expect(r.reachedTarget).toBe(false);
    // (3,0), (0,3), (6,3) and (3,6) are all nearness 9; (3,0) and (0,3) are 3 steps away; lower y wins.
    expect(r.destination).toEqual(t(3, 0));
  });

  it('copes with a target out of bounds', () => {
    const grid = open(3, 3);
    const r = route(grid, t(0, 0), t(5, 1));
    expect(r.reachedTarget).toBe(false);
    expect(r.destination).toEqual(t(2, 1));
  });
});

describe('findRoute tie-breaks for the nearest tile', () => {
  const wall = gridFromRows(ROW_WALL);

  it('prefers the shorter path over the lower y', () => {
    const r = route(wall, t(0, 3), t(2, 2));
    expect(r.destination).toEqual(t(2, 3));
    expect(r.reachedTarget).toBe(false);
  });

  it('then prefers the lower y', () => {
    const r = route(wall, t(0, 2), t(2, 2));
    expect(r.destination).toEqual(t(2, 1));
  });

  it('then prefers the lower x', () => {
    const r = route(gridFromRows(COLUMN_WALL), t(2, 0), t(2, 2));
    expect(r.destination).toEqual(t(1, 2));
  });
});
