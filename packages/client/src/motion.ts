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
 * A slide along `points`, started at `startMs`. `msPerSegment` is the time one whole tile takes (the
 * name is historical): a segment takes `msPerSegment` times its length in tiles, where the length is
 * max(|dx|, |dy|) (the server counts a diagonal step as one tile), so a sliver takes a sliver of time
 * and a zero-length segment takes none. A still character has a single point.
 */
export interface Motion {
  readonly points: readonly Point[];
  readonly startMs: number;
  readonly msPerSegment: number;
}

/** The length of a segment in tiles: Chebyshev, so a diagonal step is 1. */
function segmentLength(a: Point, b: Point): number {
  return Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

/**
 * Where `elapsedMs` falls along the motion: the index of the segment being drawn (points[index] to
 * points[index + 1]) and how far along it, 0 to 1. Finished (or still) motions give the last point
 * with t = 0. Zero-length segments are skipped.
 */
function locate(motion: Motion, elapsedMs: number): { index: number; t: number } {
  const { points, msPerSegment } = motion;
  const lastIndex = points.length - 1;
  if (lastIndex === 0 || msPerSegment <= 0) return { index: lastIndex, t: 0 };
  let start = 0;
  for (let i = 0; i < lastIndex; i++) {
    const duration = segmentLength(points[i]!, points[i + 1]!) * msPerSegment;
    if (duration > 0 && elapsedMs < start + duration) return { index: i, t: Math.max(0, (elapsedMs - start) / duration) };
    start += duration;
  }
  return { index: lastIndex, t: 0 };
}

export function stillAt(tile: Point, nowMs: number): Motion {
  return { points: [{ x: tile.x, y: tile.y }], startMs: nowMs, msPerSegment: 0 };
}

/** Where the motion is drawn at `nowMs`: piecewise linear through the points, clamped to the last. */
export function positionAt(motion: Motion, nowMs: number): Point {
  const { points } = motion;
  const { index, t } = locate(motion, nowMs - motion.startMs);
  const a = points[index]!;
  if (index === points.length - 1) return { x: a.x, y: a.y };
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
  // The segment being drawn; a still motion (or one that has finished) has nothing left to visit.
  const { index } = locate(motion, nowMs - motion.startMs);
  const remaining = motion.points.slice(index + 1);
  const rest = [...remaining, ...through].map((p) => ({ x: p.x, y: p.y }));
  const kept = rest.length > MAX_SLIDE_POINTS - 1 ? rest.slice(rest.length - (MAX_SLIDE_POINTS - 1)) : rest;
  return { points: [positionAt(motion, nowMs), ...kept], startMs: nowMs, msPerSegment };
}
