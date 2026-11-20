import { describe, expect, it } from 'vitest';
import { nextRandom, rollSpread } from './index';

describe('nextRandom', () => {
  it('gives the same value and state for the same state', () => {
    expect(nextRandom(123)).toEqual(nextRandom(123));
  });

  it('gives whole numbers from 0 to 2^32 - 1, and a 32-bit state', () => {
    let state = 7;
    for (let i = 0; i < 1000; i++) {
      const r = nextRandom(state);
      expect(Number.isInteger(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(r.state)).toBe(true);
      expect(r.state).toBeGreaterThanOrEqual(0);
      expect(r.state).toBeLessThanOrEqual(0xffffffff);
      state = r.state;
    }
  });

  it('is mulberry32: the state advances by 0x6d2b79f5 each call', () => {
    expect(nextRandom(0).state).toBe(0x6d2b79f5);
    expect(nextRandom(0x6d2b79f5).state).toBe((0x6d2b79f5 * 2) >>> 0);
  });
});

describe('rollSpread', () => {
  it('stays in -10..+10 and hits all 21 values over 10 000 rolls from seed 1', () => {
    let state = 1;
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const roll = rollSpread(state);
      expect(roll.percent).toBeGreaterThanOrEqual(-10);
      expect(roll.percent).toBeLessThanOrEqual(10);
      expect(Number.isInteger(roll.percent)).toBe(true);
      seen.add(roll.percent);
      state = roll.state;
    }
    expect(seen.size).toBe(21);
  });

  it('gives the same sequence from the same seed', () => {
    const run = (): number[] => {
      let state = 99;
      const out: number[] = [];
      for (let i = 0; i < 50; i++) {
        const roll = rollSpread(state);
        out.push(roll.percent);
        state = roll.state;
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('uses the generator value mod 21, minus 10', () => {
    const r = nextRandom(5);
    expect(rollSpread(5)).toEqual({ percent: (r.value % 21) - 10, state: r.state });
  });
});
