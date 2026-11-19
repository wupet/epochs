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

/**
 * The most points a slide may hold (the drawn start plus up to 7 more). When several ticks arrive at
 * once (catch-up after a stall or a backgrounded tab), the old path is kept so the slide does not cut
 * across wall corners, but the oldest unvisited points beyond this cap are dropped so the slide
 * catches up within MAX_SLIDE_POINTS - 1 segment times instead of replaying every missed tile.
 */
export const MAX_SLIDE_POINTS = 8;

/**
 * A new slide starting from wherever the motion is drawn right now (so nothing jumps), continuing
 * through the old path's points not yet reached, then through `through`. Capped at MAX_SLIDE_POINTS.
 */
export function retarget(motion: Motion, through: readonly Point[], nowMs: number, msPerSegment: number): Motion {
  const { points, startMs, msPerSegment: oldMs } = motion;
  // The segment being drawn; a still motion (or one that has finished) has nothing left to visit.
  const progress = points.length === 1 || oldMs <= 0 ? points.length : Math.max(0, (nowMs - startMs) / oldMs);
  const index = Math.min(Math.floor(progress), points.length - 1);
  const remaining = points.slice(index + 1);
  const rest = [...remaining, ...through].map((p) => ({ x: p.x, y: p.y }));
  const kept = rest.length > MAX_SLIDE_POINTS - 1 ? rest.slice(rest.length - (MAX_SLIDE_POINTS - 1)) : rest;
  return { points: [positionAt(motion, nowMs), ...kept], startMs: nowMs, msPerSegment };
}
