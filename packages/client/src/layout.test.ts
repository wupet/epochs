import { describe, expect, it } from 'vitest';
import { MAX_TILE_SIZE, MIN_TILE_SIZE, ZOOM_TILE_SIZES, computeLayout, fitTileSize, tileAtScreen, zoomIn, zoomOut } from './layout';

describe('fitTileSize', () => {
  it('fits the whole map in the view', () => {
    expect(fitTileSize(1280, 665, 32, 32)).toBe(20);
  });

  it('never goes below 12', () => {
    expect(fitTileSize(100, 100, 32, 32)).toBe(12);
  });

  it('never goes above 64: a huge view fits at the largest zoom, a tiny one at the smallest', () => {
    expect(fitTileSize(3840, 2160, 32, 32)).toBe(64); // 3840/32 = 120, 2160/32 = 67, both over the limit
    expect(fitTileSize(50, 50, 32, 32)).toBe(12);
  });

  it('exports the zoom limits as the first and last zoom sizes', () => {
    expect(MIN_TILE_SIZE).toBe(12);
    expect(MAX_TILE_SIZE).toBe(64);
    expect(MIN_TILE_SIZE).toBe(ZOOM_TILE_SIZES[0]);
    expect(MAX_TILE_SIZE).toBe(ZOOM_TILE_SIZES[ZOOM_TILE_SIZES.length - 1]);
  });
});

describe('zoom steps', () => {
  it('steps through ZOOM_TILE_SIZES and stops at both ends', () => {
    expect(ZOOM_TILE_SIZES).toEqual([12, 16, 20, 24, 32, 40, 48, 64]);
    expect(zoomIn(20)).toBe(24);
    expect(zoomIn(64)).toBe(64);
    expect(zoomOut(20)).toBe(16);
    expect(zoomOut(12)).toBe(12);
  });

  it('steps from a size between entries (a fit size) to the next entry', () => {
    expect(zoomIn(21)).toBe(24);
    expect(zoomOut(21)).toBe(20);
  });
});

describe('computeLayout', () => {
  it('centres a map that fits, rounding down', () => {
    expect(computeLayout(1280, 665, 32, 32, 20, { x: 0, y: 0 })).toEqual({ tileSize: 20, originX: 320, originY: 12 });
    // Focus does not matter while the map fits.
    expect(computeLayout(1280, 665, 32, 32, 20, { x: 31, y: 31 })).toEqual({ tileSize: 20, originX: 320, originY: 12 });
  });

  it('clamps the origin at the map edges when the map is bigger than the view', () => {
    expect(computeLayout(1280, 665, 32, 32, 64, { x: 0, y: 0 })).toEqual({ tileSize: 64, originX: 0, originY: 0 });
    expect(computeLayout(1280, 665, 32, 32, 64, { x: 31, y: 31 })).toEqual({
      tileSize: 64,
      originX: 1280 - 2048,
      originY: 665 - 2048,
    });
  });

  it('puts the focus tile centre at the view centre when not near an edge', () => {
    const layout = computeLayout(1280, 665, 32, 32, 64, { x: 16, y: 16 });
    expect(layout.originX + (16 + 0.5) * 64).toBe(640);
    expect(layout.originY + (16 + 0.5) * 64).toBe(332.5);
  });

  it('centres each axis on its own when only one axis fits', () => {
    const layout = computeLayout(1280, 665, 10, 32, 64, { x: 0, y: 16 });
    expect(layout.originX).toBe(Math.floor((1280 - 640) / 2));
    expect(layout.originY + 16.5 * 64).toBe(332.5);
  });
});

describe('tileAtScreen', () => {
  it('maps a screen point back to the tile it is in', () => {
    const layout = computeLayout(1280, 665, 32, 32, 64, { x: 16, y: 16 });
    const sx = layout.originX + 20.5 * 64;
    const sy = layout.originY + 14.5 * 64;
    expect(sx).toBe(896);
    expect(sy).toBe(204.5);
    expect(tileAtScreen(layout, sx, sy)).toEqual({ x: 20, y: 14 });
  });

  it('floors, so points left of or above the map give negative tiles', () => {
    const layout = { tileSize: 20, originX: 320, originY: 12 };
    expect(tileAtScreen(layout, 320, 12)).toEqual({ x: 0, y: 0 });
    expect(tileAtScreen(layout, 339.9, 31.9)).toEqual({ x: 0, y: 0 });
    expect(tileAtScreen(layout, 319, 11)).toEqual({ x: -1, y: -1 });
  });
});
