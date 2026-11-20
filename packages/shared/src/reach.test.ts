import { describe, expect, it } from 'vitest';
import { canStrike, gridFromRows, hasLineOfSight, inReach } from './index';

const t = (x: number, y: number) => ({ x, y });
const open = (w = 12, h = 12) => gridFromRows(Array.from({ length: h }, () => '.'.repeat(w)));
function withWalls(w: number, h: number, walls: [number, number][]) {
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (walls.some(([wx, wy]) => wx === x && wy === y) ? '#' : '.')).join(''),
  );
  return gridFromRows(rows);
}

describe('canStrike', () => {
  const pillar = withWalls(5, 5, [[2, 2]]);

  it('is true for an orthogonal neighbour', () => {
    expect(canStrike(pillar, t(1, 1), t(2, 1))).toBe(true);
  });

  it("is false for a diagonal past a pillar's corner", () => {
    expect(canStrike(pillar, t(1, 2), t(2, 3))).toBe(false);
  });

  it('is true for a free diagonal, false for the same tile or anything farther', () => {
    expect(canStrike(pillar, t(0, 0), t(1, 1))).toBe(true);
    expect(canStrike(pillar, t(0, 0), t(0, 0))).toBe(false);
    expect(canStrike(pillar, t(0, 0), t(2, 0))).toBe(false);
  });
});

describe('hasLineOfSight', () => {
  it('is true on an open grid', () => {
    expect(hasLineOfSight(open(), t(0, 0), t(2, 1))).toBe(true);
    expect(hasLineOfSight(open(), t(0, 0), t(9, 4))).toBe(true);
  });

  it('ignores a blocked tile the segment does not touch, and is blocked by one it does', () => {
    expect(hasLineOfSight(withWalls(4, 4, [[0, 1]]), t(0, 0), t(2, 1))).toBe(true);
    expect(hasLineOfSight(withWalls(4, 4, [[1, 1]]), t(0, 0), t(2, 1))).toBe(false);
  });

  it('counts both side tiles when the segment passes exactly through a corner', () => {
    expect(hasLineOfSight(withWalls(4, 4, [[1, 0]]), t(0, 0), t(2, 2))).toBe(false);
    expect(hasLineOfSight(withWalls(4, 4, [[0, 1]]), t(0, 0), t(2, 2))).toBe(false);
    expect(hasLineOfSight(withWalls(4, 4, []), t(0, 0), t(2, 2))).toBe(true);
  });

  it('does not check the end tiles', () => {
    expect(
      hasLineOfSight(
        withWalls(4, 4, [
          [0, 0],
          [3, 0],
        ]),
        t(0, 0),
        t(3, 0),
      ),
    ).toBe(true);
  });

  it('is symmetric', () => {
    const grid = withWalls(8, 8, [
      [3, 2],
      [4, 5],
      [2, 4],
    ]);
    for (let a = 0; a < 64; a += 5) {
      for (let b = 0; b < 64; b += 3) {
        const from = t(a % 8, Math.floor(a / 8));
        const to = t(b % 8, Math.floor(b / 8));
        expect(hasLineOfSight(grid, from, to)).toBe(hasLineOfSight(grid, to, from));
      }
    }
  });
});

describe('inReach', () => {
  it('range 1 is canStrike', () => {
    const grid = withWalls(5, 5, [[2, 2]]);
    expect(inReach(grid, t(1, 2), t(2, 3), 1)).toBe(false);
    expect(inReach(grid, t(1, 1), t(2, 1), 1)).toBe(true);
    expect(inReach(grid, t(0, 0), t(2, 0), 1)).toBe(false);
  });

  it('range 6: true at distance 6 with a clear line, false at 7, false behind a pillar', () => {
    const grid = withWalls(12, 5, [[3, 2]]);
    expect(inReach(grid, t(0, 0), t(6, 0), 6)).toBe(true);
    expect(inReach(grid, t(0, 0), t(7, 0), 6)).toBe(false);
    expect(inReach(grid, t(0, 2), t(6, 2), 6)).toBe(false);
  });
});
