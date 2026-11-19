import { describe, expect, it } from 'vitest';
import { PULSE_MS, PULSE_STRENGTH, pulseEnabledFromSearch, pulseLevel } from './pulse';

describe('pulseLevel', () => {
  it('is full strength at 0 ms and gone at PULSE_MS', () => {
    expect(pulseLevel(0)).toBe(PULSE_STRENGTH);
    expect(pulseLevel(PULSE_MS)).toBe(0);
    expect(pulseLevel(PULSE_MS + 500)).toBe(0);
  });

  it('falls monotonically in between', () => {
    let last = pulseLevel(0);
    for (let ms = 1; ms <= PULSE_MS; ms++) {
      const level = pulseLevel(ms);
      expect(level).toBeLessThanOrEqual(last);
      last = level;
    }
    expect(pulseLevel(PULSE_MS / 2)).toBeCloseTo(PULSE_STRENGTH / 2);
  });

  it('is 0 when the strength is 0', () => {
    expect(pulseLevel(0, 0)).toBe(0);
    expect(pulseLevel(10, 0)).toBe(0);
  });

  it('uses the strength it is given', () => {
    expect(pulseLevel(0, 0.5)).toBe(0.5);
  });

  it('never exceeds the strength for a negative time', () => {
    expect(pulseLevel(-10)).toBe(PULSE_STRENGTH);
  });
});

describe('pulseEnabledFromSearch', () => {
  it('is on only for pulse=1 or pulse=on', () => {
    expect(pulseEnabledFromSearch('')).toBe(false);
    expect(pulseEnabledFromSearch('?pulse=1')).toBe(true);
    expect(pulseEnabledFromSearch('?pulse=on')).toBe(true);
    expect(pulseEnabledFromSearch('?pulse=0')).toBe(false);
    expect(pulseEnabledFromSearch('?pulse=off')).toBe(false);
    expect(pulseEnabledFromSearch('?a=b&pulse=1')).toBe(true);
    expect(pulseEnabledFromSearch('?other=1')).toBe(false);
  });
});
