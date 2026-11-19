import { describe, expect, it } from 'vitest';
import {
  STEP_DIRECTIONS,
  canStep,
  gridFromRows,
  gridToRows,
  inBounds,
  isWalkable,
  sameTile,
} from './index';

describe('gridFromRows and gridToRows', () => {
  it('round-trips', () => {
    const rows = ['..#.', '#...', '.#.#'];
    const grid = gridFromRows(rows);
    expect(grid.width).toBe(4);
    expect(grid.height).toBe(3);
    expect(gridToRows(grid)).toEqual(rows);
  });

  it('stores blocked tiles as a flat array, index y * width + x', () => {
    const grid = gridFromRows(['.#.', '..#']);
    expect(grid.blocked).toEqual([false, true, false, false, false, true]);
  });

  it('throws on ragged rows', () => {
    expect(() => gridFromRows(['..', '.'])).toThrow(Error);
  });

  it('throws on unknown characters', () => {
    expect(() => gridFromRows(['.x'])).toThrow(Error);
  });

  it('throws on zero size', () => {
    expect(() => gridFromRows([])).toThrow(Error);
    expect(() => gridFromRows([''])).toThrow(Error);
  });
});

describe('inBounds and isWalkable', () => {
  const grid = gridFromRows(['.#', '..']);

  it('knows the edges of the grid', () => {
    expect(inBounds(grid, { x: 0, y: 0 })).toBe(true);
    expect(inBounds(grid, { x: 1, y: 1 })).toBe(true);
    expect(inBounds(grid, { x: -1, y: 0 })).toBe(false);
    expect(inBounds(grid, { x: 0, y: -1 })).toBe(false);
    expect(inBounds(grid, { x: 2, y: 0 })).toBe(false);
    expect(inBounds(grid, { x: 0, y: 2 })).toBe(false);
  });

  it('is false out of bounds and on blocked tiles, true on open ones', () => {
    expect(isWalkable(grid, { x: 0, y: 0 })).toBe(true);
    expect(isWalkable(grid, { x: 1, y: 0 })).toBe(false);
    expect(isWalkable(grid, { x: 5, y: 5 })).toBe(false);
    expect(isWalkable(grid, { x: -1, y: 0 })).toBe(false);
  });
});

describe('sameTile', () => {
  it('compares coordinates', () => {
    expect(sameTile({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(sameTile({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false);
  });
});

describe('STEP_DIRECTIONS', () => {
  it('lists N, E, S, W, NE, SE, SW, NW with y growing downward', () => {
    expect(STEP_DIRECTIONS).toEqual([
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]);
  });
});

describe('canStep', () => {
  it('allows all 8 neighbours on an open grid', () => {
    const grid = gridFromRows(['...', '...', '...']);
    const from = { x: 1, y: 1 };
    for (const d of STEP_DIRECTIONS) {
      expect(canStep(grid, from, { x: from.x + d.x, y: from.y + d.y })).toBe(true);
    }
  });

  it('refuses non-neighbours and the same tile', () => {
    const grid = gridFromRows(['...', '...', '...']);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(false);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(canStep(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(false);
  });

  it('refuses a step into a blocked tile', () => {
    const grid = gridFromRows(['.#', '..']);
    expect(canStep(grid, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('refuses a step out of bounds', () => {
    const grid = gridFromRows(['..', '..']);
    expect(canStep(grid, { x: 0, y: 0 }, { x: -1, y: 0 })).toBe(false);
    expect(canStep(grid, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(false);
  });

  it('refuses a diagonal when either side tile is blocked (no corner cutting)', () => {
    expect(canStep(gridFromRows(['.#', '..']), { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(canStep(gridFromRows(['..', '#.']), { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(canStep(gridFromRows(['..', '..']), { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
  });

  it('is symmetric for every pair of walkable neighbours on a grid with walls', () => {
    const grid = gridFromRows(['..#..', '.#...', '.....', '#..#.', '.....']);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const a = { x, y };
        for (const d of STEP_DIRECTIONS) {
          const b = { x: x + d.x, y: y + d.y };
          // Stepping is judged by where you arrive, so symmetry is about the corner rule:
          // it only applies when both ends are walkable.
          if (!isWalkable(grid, a) || !isWalkable(grid, b)) continue;
          expect(canStep(grid, a, b)).toBe(canStep(grid, b, a));
        }
      }
    }
  });
});
