import { describe, expect, it } from 'vitest';
import { canStep, findRoute, gridFromRows, isWalkable } from '@epochs/shared';
import { TEST_MAP_ROWS, TEST_MAP_SPAWN } from './test-map';

describe('test map', () => {
  it('is 32 rows of 32 characters that gridFromRows accepts', () => {
    expect(TEST_MAP_ROWS).toHaveLength(32);
    for (const row of TEST_MAP_ROWS) expect(row).toHaveLength(32);
    const grid = gridFromRows(TEST_MAP_ROWS);
    expect(grid.width).toBe(32);
    expect(grid.height).toBe(32);
  });

  it('has a walkable spawn', () => {
    expect(isWalkable(gridFromRows(TEST_MAP_ROWS), TEST_MAP_SPAWN)).toBe(true);
  });

  it('has an enclosed room: some walkable tile cannot be reached from the spawn', () => {
    const grid = gridFromRows(TEST_MAP_ROWS);
    let unreachable = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const tile = { x, y };
        if (!isWalkable(grid, tile)) continue;
        const route = findRoute(grid, TEST_MAP_SPAWN, tile);
        if (!route.reachedTarget) unreachable++;
      }
    }
    expect(unreachable).toBeGreaterThan(0);
  });

  it('has a diagonal pinch: two walkable diagonal neighbours that cannot be stepped between', () => {
    const grid = gridFromRows(TEST_MAP_ROWS);
    let pinches = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        for (const d of [{ x: 1, y: 1 }, { x: 1, y: -1 }]) {
          const a = { x, y };
          const b = { x: x + d.x, y: y + d.y };
          if (isWalkable(grid, a) && isWalkable(grid, b) && !canStep(grid, a, b)) pinches++;
        }
      }
    }
    expect(pinches).toBeGreaterThan(0);
  });
});
