import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@epochs/shared';
import { SLIDE_TIME_SCALE, msPerTile, positionAt, retarget, stillAt } from './motion';

const WALK_MS = 500;

describe('msPerTile', () => {
  it('is the time the server spends per tile at that speed', () => {
    expect(SLIDE_TIME_SCALE).toBe(1);
    expect(msPerTile(500)).toBe(500);
    expect(msPerTile(1000)).toBe(250);
    expect(msPerTile(2000)).toBe(125);
  });

  it('falls back to the walk value for a speed of 0 or less', () => {
    expect(msPerTile(0)).toBe(WALK_MS);
    expect(msPerTile(-3)).toBe(WALK_MS);
    expect(msPerTile(0)).toBe(TICK_MS * 2);
  });
});

describe('motion', () => {
  it('stays put when still', () => {
    const m = stillAt({ x: 3, y: 4 }, 100);
    expect(positionAt(m, 100)).toEqual({ x: 3, y: 4 });
    expect(positionAt(m, 5000)).toEqual({ x: 3, y: 4 });
  });

  it('slides linearly along one segment, clamped to both ends', () => {
    const m = { points: [{ x: 0, y: 0 }, { x: 2, y: 4 }], startMs: 1000, msPerSegment: 400 };
    expect(positionAt(m, 500)).toEqual({ x: 0, y: 0 });
    expect(positionAt(m, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(m, 1200)).toEqual({ x: 1, y: 2 });
    expect(positionAt(m, 1400)).toEqual({ x: 2, y: 4 });
    expect(positionAt(m, 9000)).toEqual({ x: 2, y: 4 });
  });

  it('runs through every point of a polyline, one segment at a time', () => {
    const m = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], startMs: 0, msPerSegment: 100 };
    expect(positionAt(m, 50)).toEqual({ x: 0.5, y: 0 });
    expect(positionAt(m, 100)).toEqual({ x: 1, y: 0 });
    expect(positionAt(m, 150)).toEqual({ x: 1, y: 0.5 });
    expect(positionAt(m, 200)).toEqual({ x: 1, y: 1 });
    expect(positionAt(m, 1000)).toEqual({ x: 1, y: 1 });
  });

  it('returns the last point when msPerSegment is 0 or less', () => {
    const m = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], startMs: 0, msPerSegment: 0 };
    expect(positionAt(m, 0)).toEqual({ x: 10, y: 0 });
    expect(positionAt({ ...m, msPerSegment: -5 }, 0)).toEqual({ x: 10, y: 0 });
  });

  it('retargets mid-slide from the current drawn point, with no jump', () => {
    const m = { points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], startMs: 0, msPerSegment: 500 };
    const now = 250;
    const drawn = positionAt(m, now);
    const next = retarget(m, [{ x: 2, y: 2 }], now, 500);
    expect(next.points).toEqual([drawn, { x: 2, y: 2 }]);
    expect(next.startMs).toBe(now);
    expect(next.msPerSegment).toBe(500);
    expect(positionAt(next, now)).toEqual(drawn);
    expect(positionAt(next, now + 500)).toEqual({ x: 2, y: 2 });
  });

  it('retargets through several points', () => {
    const m = stillAt({ x: 0, y: 0 }, 0);
    const next = retarget(m, [{ x: 1, y: 0 }, { x: 1, y: 1 }], 10, 125);
    expect(positionAt(next, 10 + 125)).toEqual({ x: 1, y: 0 });
    expect(positionAt(next, 10 + 250)).toEqual({ x: 1, y: 1 });
  });
});
