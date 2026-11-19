/**
 * Smooth movement: a character is drawn sliding along a polyline of tiles at a pace set by its
 * speed. Pure: time is always passed in as `nowMs`; nothing here reads a clock or touches the DOM.
 */
import { STEP, TICK_MS } from '@epochs/shared';

/**
 * The one knob for slide length: 1 = a slide takes exactly the time the server spends per tile at
 * that speed. Raise slightly (e.g. 1.08) if movement hitches at each tile.
 */
export const SLIDE_TIME_SCALE = 1;

/** The walking speed, in millitiles per tick (debug movement modes: walk is 500, run 1000, horse 2000). */
const WALK_SPEED = STEP / 2;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How long one tile's slide takes, in ms, for a character of `speed` millitiles per tick. */
export function msPerTile(speed: number): number {
  const s = speed > 0 ? speed : WALK_SPEED;
  return ((TICK_MS * STEP) / s) * SLIDE_TIME_SCALE;
}

/**
 * A slide along `points`, started at `startMs`, taking `msPerSegment` for each segment between
 * consecutive points. A still character has a single point.
 */
export interface Motion {
  readonly points: readonly Point[];
  readonly startMs: number;
  readonly msPerSegment: number;
}

export function stillAt(tile: Point, nowMs: number): Motion {
  return { points: [{ x: tile.x, y: tile.y }], startMs: nowMs, msPerSegment: 0 };
}

/** Where the motion is drawn at `nowMs`: piecewise linear through the points, clamped to the last. */
export function positionAt(motion: Motion, nowMs: number): Point {
  const { points, startMs, msPerSegment } = motion;
  const last = points[points.length - 1]!;
  if (points.length === 1 || msPerSegment <= 0) return { x: last.x, y: last.y };
  const progress = Math.max(0, (nowMs - startMs) / msPerSegment);
  const segments = points.length - 1;
  if (progress >= segments) return { x: last.x, y: last.y };
  const index = Math.floor(progress);
  const t = progress - index;
  const a = points[index]!;
  const b = points[index + 1]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A new slide through `through`, starting from wherever the motion is drawn right now, so nothing jumps. */
export function retarget(motion: Motion, through: readonly Point[], nowMs: number, msPerSegment: number): Motion {
  return {
    points: [positionAt(motion, nowMs), ...through.map((p) => ({ x: p.x, y: p.y }))],
    startMs: nowMs,
    msPerSegment,
  };
}
