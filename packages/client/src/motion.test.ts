import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@epochs/shared';
import { TWEEN_MS, positionAt, retarget, stillAt } from './motion';

describe('motion', () => {
  it('slides over one tick', () => {
    expect(TWEEN_MS).toBe(TICK_MS);
  });

  it('stays put when still', () => {
    const m = stillAt({ x: 3, y: 4 }, 100);
    expect(positionAt(m, 100)).toEqual({ x: 3, y: 4 });
    expect(positionAt(m, 5000)).toEqual({ x: 3, y: 4 });
  });

  it('is at from at the start, the midpoint halfway, and to at and after TWEEN_MS', () => {
    const m = { from: { x: 0, y: 0 }, to: { x: 2, y: 4 }, startMs: 1000 };
    expect(positionAt(m, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(m, 1000 + TWEEN_MS / 2)).toEqual({ x: 1, y: 2 });
    expect(positionAt(m, 1000 + TWEEN_MS)).toEqual({ x: 2, y: 4 });
    expect(positionAt(m, 1000 + TWEEN_MS * 10)).toEqual({ x: 2, y: 4 });
  });

  it('clamps to from before the start', () => {
    const m = { from: { x: 0, y: 0 }, to: { x: 2, y: 4 }, startMs: 1000 };
    expect(positionAt(m, 500)).toEqual({ x: 0, y: 0 });
  });

  it('honours a custom duration, and a duration of 0 or less snaps to the target', () => {
    const m = { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, startMs: 0 };
    expect(positionAt(m, 50, 100)).toEqual({ x: 5, y: 0 });
    expect(positionAt(m, 0, 0)).toEqual({ x: 10, y: 0 });
    expect(positionAt(m, 0, -5)).toEqual({ x: 10, y: 0 });
  });

  it('retargets mid-slide from the current drawn point, with no jump', () => {
    const m = { from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, startMs: 0 };
    const now = TWEEN_MS / 2;
    const drawn = positionAt(m, now);
    const next = retarget(m, { x: 2, y: 2 }, now);
    expect(next.from).toEqual(drawn);
    expect(next.to).toEqual({ x: 2, y: 2 });
    expect(next.startMs).toBe(now);
    expect(positionAt(next, now)).toEqual(drawn);
    expect(positionAt(next, now + TWEEN_MS)).toEqual({ x: 2, y: 2 });
  });
});
