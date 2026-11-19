/**
 * Zoom, camera and pointer maths for the grid view. Pure: sizes in screen pixels, no DOM.
 */
import type { Point } from './motion';

/** The tile sizes (px) the zoom keys step through. */
export const ZOOM_TILE_SIZES = [12, 16, 20, 24, 32, 40, 48, 64] as const;

/** The smallest tile size (px). Player-adjustable zoom stays within these limits; zoom is display-only. */
export const MIN_TILE_SIZE = ZOOM_TILE_SIZES[0];

/** The largest tile size (px). Player-adjustable zoom stays within these limits; zoom is display-only. */
export const MAX_TILE_SIZE = ZOOM_TILE_SIZES[ZOOM_TILE_SIZES.length - 1]!;

/** The largest whole tile size that shows the whole map in the view, kept within the zoom limits (12 to 64). */
export function fitTileSize(viewW: number, viewH: number, gridW: number, gridH: number): number {
  return Math.min(MAX_TILE_SIZE, Math.max(MIN_TILE_SIZE, Math.floor(Math.min(viewW / gridW, viewH / gridH))));
}

/** The next larger zoom size, or `current` if there is none. */
export function zoomIn(current: number): number {
  return ZOOM_TILE_SIZES.find((size) => size > current) ?? current;
}

/** The next smaller zoom size, or `current` if there is none. */
export function zoomOut(current: number): number {
  for (let i = ZOOM_TILE_SIZES.length - 1; i >= 0; i--) {
    const size = ZOOM_TILE_SIZES[i]!;
    if (size < current) return size;
  }
  return current;
}

/** Where the map sits on screen: `originX`, `originY` are the screen pixels of tile (0, 0)'s top-left corner. */
export interface Layout {
  readonly tileSize: number;
  readonly originX: number;
  readonly originY: number;
}

/** One axis of the layout. A map that fits is centred; a bigger one follows the focus, never showing past its edges. */
function originOnAxis(view: number, tiles: number, tileSize: number, focus: number): number {
  const mapPx = tiles * tileSize;
  if (mapPx <= view) return Math.floor((view - mapPx) / 2);
  const centred = view / 2 - (focus + 0.5) * tileSize;
  return Math.min(0, Math.max(view - mapPx, centred));
}

export function computeLayout(
  viewW: number,
  viewH: number,
  gridW: number,
  gridH: number,
  tileSize: number,
  focus: Point,
): Layout {
  return {
    tileSize,
    originX: originOnAxis(viewW, gridW, tileSize, focus.x),
    originY: originOnAxis(viewH, gridH, tileSize, focus.y),
  };
}

/** The tile under a screen point. It may be outside the grid; the caller checks bounds. */
export function tileAtScreen(layout: Layout, sx: number, sy: number): Point {
  return {
    x: Math.floor((sx - layout.originX) / layout.tileSize),
    y: Math.floor((sy - layout.originY) / layout.tileSize),
  };
}
