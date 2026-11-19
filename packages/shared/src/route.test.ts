import { describe, expect, it } from 'vitest';
import { NEAREST_SEARCH_RADIUS, canStep, findRoute, gridFromRows, nearness, sameTile } from './index';
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

describe('route to a far reachable target', () => {
  it('routes exactly to a reachable target more than 16 tiles away on an open grid', () => {
    const result = route(open(40, 3), t(0, 1), t(39, 1));
    expect(result.reachedTarget).toBe(true);
    expect(result.destination).toEqual(t(39, 1));
    expect(result.path).toHaveLength(39);
    expect(result.path[result.path.length - 1]).toEqual(t(39, 1));
  });
});

describe('nearness', () => {
  it('is the Chebyshev distance: a diagonal tile is 1 away', () => {
    expect(nearness(t(0, 0), t(3, 4))).toBe(4);
    expect(nearness(t(2, 2), t(2, 2))).toBe(0);
    expect(nearness(t(-1, 0), t(1, 0))).toBe(2);
    expect(nearness(t(2, 2), t(3, 3))).toBe(1);
  });

  it('searches 16 tiles around the click', () => {
    expect(NEAREST_SEARCH_RADIUS).toBe(16);
  });
});

describe('findRoute on an open grid', () => {
  const grid = open(5, 5);

  it('takes the path closest to the straight line, not diagonal-first', () => {
    const r = route(grid, t(0, 0), t(3, 1));
    expect(r.path).toEqual([t(1, 0), t(2, 1), t(3, 1)]);
    expect(r.reachedTarget).toBe(true);
    expect(r.destination).toEqual(t(3, 1));
  });

  it('spreads the diagonal steps along a longer line', () => {
    const wide = open(8, 4);
    expect(route(wide, t(0, 0), t(6, 2)).path).toEqual([t(1, 0), t(2, 1), t(3, 1), t(4, 1), t(5, 2), t(6, 2)]);
  });

  it('puts the diagonal step in the middle when the target is mostly vertical', () => {
    expect(route(grid, t(0, 0), t(1, 3)).path).toEqual([t(0, 1), t(1, 2), t(1, 3)]);
  });

  it('keeps a straight line straight', () => {
    expect(route(grid, t(0, 0), t(4, 0)).path).toEqual([t(1, 0), t(2, 0), t(3, 0), t(4, 0)]);
    expect(route(grid, t(0, 0), t(0, 4)).path).toEqual([t(0, 1), t(0, 2), t(0, 3), t(0, 4)]);
    expect(route(grid, t(0, 0), t(4, 4)).path).toEqual([t(1, 1), t(2, 2), t(3, 3), t(4, 4)]);
    expect(route(grid, t(4, 4), t(0, 0)).path).toEqual([t(3, 3), t(2, 2), t(1, 1), t(0, 0)]);
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
    // (1,1), (1,2) and (1,3) are all nearness 1 and 1 step away; lower y wins.
    expect(r.destination).toEqual(t(1, 1));
    expect(r.path).toEqual([t(1, 1)]);
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
    // Every reachable tile is on the outer edge, all nearness 3 from (3,3). The start is one of them
    // and is 0 steps away, so the walker stays put.
    expect(r.destination).toEqual(t(0, 0));
    expect(r.path).toEqual([]);
  });

  it('copes with a target out of bounds', () => {
    const grid = open(3, 3);
    const r = route(grid, t(0, 0), t(5, 1));
    expect(r.reachedTarget).toBe(false);
    // (2,0), (2,1) and (2,2) are all nearness 3 and 2 steps away; lower y wins.
    expect(r.destination).toEqual(t(2, 0));
  });
});

describe('findRoute tie-breaks for the nearest tile', () => {
  const wall = gridFromRows(ROW_WALL);

  it('prefers the shorter path over the lower y', () => {
    // A diagonal tile is nearness 1 and (1,3) is one step away; (1,1) is 3 steps round the wall.
    const r = route(wall, t(0, 3), t(2, 2));
    expect(r.destination).toEqual(t(1, 3));
    expect(r.reachedTarget).toBe(false);
  });

  it('then prefers the lower y', () => {
    // (1,1) and (1,3) are both 2 steps away (the diagonals past the wall end are blocked).
    const r = route(wall, t(0, 2), t(2, 2));
    expect(r.destination).toEqual(t(1, 1));
  });

  it('then prefers the lower x', () => {
    // (1,1) and (3,1) are both 2 steps away.
    const r = route(gridFromRows(COLUMN_WALL), t(2, 0), t(2, 2));
    expect(r.destination).toEqual(t(1, 1));
  });
});

describe('findRoute search radius', () => {
  // 40 by 3, open only at x 0 to 2.
  const corridor = gridFromRows(Array.from({ length: 3 }, () => '...' + '#'.repeat(37)));

  it('uses a tile exactly 16 away from the click', () => {
    const r = route(corridor, t(0, 1), t(18, 1));
    expect(r.reachedTarget).toBe(false);
    // (2,0), (2,1) and (2,2) are all nearness 16 and 2 steps away; lower y wins.
    expect(r.destination).toEqual(t(2, 0));
    expect(nearness(r.destination, t(18, 1))).toBe(NEAREST_SEARCH_RADIUS);
  });

  it('stays put when no reachable tile is within 16 of the click', () => {
    expect(findRoute(corridor, t(0, 1), t(19, 1))).toEqual({
      destination: t(0, 1),
      path: [],
      reachedTarget: false,
    });
  });
});
