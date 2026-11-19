import { describe, expect, it } from 'vitest';
import { TickTiming } from './tick-timing';

describe('TickTiming', () => {
  it('summarises the intervals between arrivals', () => {
    const t = new TickTiming();
    for (const ms of [0, 250, 500, 760]) t.record(ms);
    const s = t.summary();
    expect(s.count).toBe(3);
    expect(s.minMs).toBe(250);
    expect(s.maxMs).toBe(260);
    expect(s.meanMs).toBeCloseTo(253.33, 1);
    expect(s.p95Ms).toBe(260);
  });

  it('reports zeros with fewer than 2 arrivals', () => {
    const t = new TickTiming();
    const zero = { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, minMs: 0 };
    expect(t.summary()).toEqual(zero);
    t.record(100);
    expect(t.summary()).toEqual(zero);
  });

  it('uses the nearest-rank method for p95', () => {
    const t = new TickTiming();
    // 20 intervals of 1..20 ms: the nearest rank for p95 is ceil(0.95 * 20) = the 19th value.
    let at = 0;
    t.record(at);
    for (let i = 1; i <= 20; i++) {
      at += i;
      t.record(at);
    }
    expect(t.summary().p95Ms).toBe(19);
    expect(t.summary().maxMs).toBe(20);
  });
});
