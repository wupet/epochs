import { describe, expect, it } from 'vitest';
import { TICK_MS } from '@epochs/shared';
import { ManualClock } from './manual-clock';
import { startTickLoop } from './tick-loop';

describe('startTickLoop', () => {
  it('runs exactly 40 ticks over 10 000 ms advanced in irregular chunks', () => {
    const clock = new ManualClock();
    let ticks = 0;
    const loop = startTickLoop(() => ticks++, clock);
    const chunks = [7, 300, 1, 999, 2500, 13, 487, 1693, 2000, 1000, 1];
    const rest = 10_000 - chunks.reduce((a, b) => a + b, 0);
    expect(rest).toBeGreaterThan(0);
    for (const ms of [...chunks, rest]) clock.advance(ms);
    expect(clock.now()).toBe(10_000);
    expect(ticks).toBe(40);
    expect(loop.ticksRun()).toBe(40);
  });

  it('does not drift over a simulated hour with every callback 37 ms late', () => {
    const clock = new ManualClock();
    const start = clock.now();
    const tickTimes: number[] = [];
    const loop = startTickLoop(() => tickTimes.push(clock.now()), clock);
    for (let i = 0; i < 3600; i++) clock.advance(1000, 37);
    expect(loop.ticksRun()).toBe(14_400);
    expect(tickTimes).toHaveLength(14_400);
    const due = start + 14_400 * TICK_MS;
    expect(tickTimes[14_399]! - due).toBeLessThanOrEqual(37);
    expect(tickTimes[14_399]!).toBeGreaterThanOrEqual(due);
  });

  it('catches up with all 4 ticks after a stall', () => {
    const clock = new ManualClock();
    let ticks = 0;
    startTickLoop(() => ticks++, clock);
    clock.advance(1000, 600);
    expect(ticks).toBe(4);
  });

  it('stops: no ticks afterwards, and the pending wake is cancelled', () => {
    const clock = new ManualClock();
    let ticks = 0;
    const loop = startTickLoop(() => ticks++, clock);
    clock.advance(500);
    expect(ticks).toBe(2);
    expect(clock.pendingCount()).toBe(1);
    loop.stop();
    expect(clock.pendingCount()).toBe(0);
    clock.advance(5000);
    expect(ticks).toBe(2);
    expect(loop.ticksRun()).toBe(2);
  });

  it('stops cleanly when stop() is called from inside onTick', () => {
    const clock = new ManualClock();
    let ticks = 0;
    const loop = startTickLoop(() => {
      ticks++;
      if (ticks === 2) loop.stop();
    }, clock);
    clock.advance(2000, 600);
    expect(ticks).toBe(2);
    expect(clock.pendingCount()).toBe(0);
  });

  it('never ticks early: 249 ms runs none, one more ms runs one', () => {
    const clock = new ManualClock();
    let ticks = 0;
    startTickLoop(() => ticks++, clock);
    clock.advance(249);
    expect(ticks).toBe(0);
    clock.advance(1);
    expect(ticks).toBe(1);
  });

  it('runs nothing at start', () => {
    const clock = new ManualClock();
    let ticks = 0;
    startTickLoop(() => ticks++, clock);
    expect(ticks).toBe(0);
  });

  it('honours a custom tick length', () => {
    const clock = new ManualClock();
    let ticks = 0;
    startTickLoop(() => ticks++, clock, 100);
    clock.advance(1000);
    expect(ticks).toBe(10);
  });
});

describe('ManualClock', () => {
  it('fires ties in scheduling order and never fires a cancelled callback', () => {
    const clock = new ManualClock();
    const order: string[] = [];
    clock.schedule(100, () => order.push('a'));
    const cancelB = clock.schedule(100, () => order.push('b'));
    clock.schedule(100, () => order.push('c'));
    cancelB();
    clock.advance(100);
    expect(order).toEqual(['a', 'c']);
  });
});
