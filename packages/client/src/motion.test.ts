import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@epochs/shared';
import { MAX_SLIDE_POINTS, SLIDE_TIME_SCALE, msPerTile, positionAt, retarget, stillAt } from './motion';

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
    // The old path's unreached point (2,0) is kept, so the slide still goes through it.
    expect(next.points).toEqual([drawn, { x: 2, y: 0 }, { x: 2, y: 2 }]);
    expect(next.startMs).toBe(now);
    expect(next.msPerSegment).toBe(500);
    expect(positionAt(next, now)).toEqual(drawn);
    expect(positionAt(next, now + 500)).toEqual({ x: 2, y: 0 });
    expect(positionAt(next, now + 1000)).toEqual({ x: 2, y: 2 });
  });

  it('keeps the old path\'s unreached points when retargeted at the same instant', () => {
    const still = stillAt({ x: 0, y: 0 }, 0);
    const first = retarget(still, [{ x: 1, y: 0 }], 0, 500);
    const second = retarget(first, [{ x: 1, y: 1 }], 0, 500);
    expect(second.points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    for (let ms = 0; ms <= 1000; ms += 10) {
      expect(positionAt(second, ms)).not.toEqual({ x: 0.5, y: 0.5 });
    }
    expect(positionAt(second, 500)).toEqual({ x: 1, y: 0 });
    expect(positionAt(second, 1000)).toEqual({ x: 1, y: 1 });
  });

  it('keeps only points after the current segment, and drops those already passed', () => {
    const m = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], startMs: 0, msPerSegment: 100 };
    // 150 ms: halfway along segment 1 (1,0)->(2,0). Points after segment 1 are (2,0) and (3,0).
    const next = retarget(m, [{ x: 3, y: 1 }], 150, 100);
    expect(next.points).toEqual([{ x: 1.5, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }]);
  });

  it('never holds more than MAX_SLIDE_POINTS points, dropping the oldest unvisited ones', () => {
    let m = stillAt({ x: 0, y: 0 }, 0);
    for (let i = 1; i <= 20; i++) m = retarget(m, [{ x: i, y: 0 }], 0, 100);
    expect(MAX_SLIDE_POINTS).toBe(8);
    expect(m.points.length).toBe(MAX_SLIDE_POINTS);
    expect(m.points[0]).toEqual({ x: 0, y: 0 });
    expect(m.points[m.points.length - 1]).toEqual({ x: 20, y: 0 });
    expect(m.points[1]).toEqual({ x: 14, y: 0 });
  });

  it('retargets through several points', () => {
    const m = stillAt({ x: 0, y: 0 }, 0);
    const next = retarget(m, [{ x: 1, y: 0 }, { x: 1, y: 1 }], 10, 125);
    expect(positionAt(next, 10 + 125)).toEqual({ x: 1, y: 0 });
    expect(positionAt(next, 10 + 250)).toEqual({ x: 1, y: 1 });
  });
});
