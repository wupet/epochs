import { describe, expect, it } from 'vitest';
import { MACRO_TICK_MS, SUBTICK_MS, SUBTICKS_PER_TICK, TICK_MS } from './index';

describe('clocks', () => {
  it('ticks every 250 ms', () => {
    expect(TICK_MS).toBe(250);
  });

  it('splits a tick into 10 subticks of 25 ms', () => {
    expect(SUBTICKS_PER_TICK).toBe(10);
    expect(SUBTICK_MS).toBe(25);
    expect(SUBTICK_MS * SUBTICKS_PER_TICK).toBe(TICK_MS);
  });

  it('runs the macro tick every 60 seconds, a whole number of ticks', () => {
    expect(MACRO_TICK_MS).toBe(60_000);
    expect(Number.isInteger(MACRO_TICK_MS / TICK_MS)).toBe(true);
  });
});
