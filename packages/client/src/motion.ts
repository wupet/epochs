/**
 * Smooth movement: a character is drawn sliding from where it was drawn to its new tile. Pure: time
 * is always passed in as `nowMs`; nothing here reads a clock or touches the DOM.
 */
import { TICK_MS } from '@epochs/shared';

/** How long a slide takes, in ms. One tick, so a character arrives just as the next tick does. */
export const TWEEN_MS = TICK_MS;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A slide from `from` to `to`, started at `startMs`. A still character has `from` equal to `to`. */
export interface Motion {
  readonly from: Point;
  readonly to: Point;
  readonly startMs: number;
}

export function stillAt(tile: Point, nowMs: number): Motion {
  return { from: { x: tile.x, y: tile.y }, to: { x: tile.x, y: tile.y }, startMs: nowMs };
}

/** Where the motion is drawn at `nowMs`: linear, clamped to the slide. A duration of 0 or less snaps to `to`. */
export function positionAt(motion: Motion, nowMs: number, durationMs: number = TWEEN_MS): Point {
  if (durationMs <= 0) return { x: motion.to.x, y: motion.to.y };
  const t = Math.min(1, Math.max(0, (nowMs - motion.startMs) / durationMs));
  return {
    x: motion.from.x + (motion.to.x - motion.from.x) * t,
    y: motion.from.y + (motion.to.y - motion.from.y) * t,
  };
}

/** A new slide to `to`, starting from wherever the motion is drawn right now, so nothing jumps. */
export function retarget(motion: Motion, to: Point, nowMs: number): Motion {
  return { from: positionAt(motion, nowMs), to: { x: to.x, y: to.y }, startMs: nowMs };
}
