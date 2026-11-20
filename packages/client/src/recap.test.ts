import { describe, expect, it } from 'vitest';
import type { RecapMessage } from '@epochs/shared';
import { recapLine, recapLines } from './recap';

describe('recapLine', () => {
  it('names the telegraph and its windup', () => {
    expect(
      recapLine({ tick: 30, attacker: 'Slime', attack: 'Touch', amount: 3, telegraph: { name: 'Touch', windupTicks: 1 } }),
    ).toBe('Slime — Touch — 3 damage — you were standing in its Touch telegraph (1-tick windup)');
  });

  it('ends at "damage" without a telegraph', () => {
    expect(recapLine({ tick: 31, attacker: 'Slime', attack: 'Bump', amount: 2, telegraph: null })).toBe('Slime — Bump — 2 damage');
  });
});

describe('recapLines', () => {
  it('lists the oldest hit first', () => {
    const recap: RecapMessage = {
      type: 'recap',
      tick: 40,
      hits: [
        { tick: 40, attacker: 'Slime', attack: 'Touch', amount: 4, telegraph: null },
        { tick: 38, attacker: 'Dummy', attack: 'Bonk', amount: 1, telegraph: null },
      ],
    };
    expect(recapLines(recap)).toEqual(['Dummy — Bonk — 1 damage', 'Slime — Touch — 4 damage']);
  });
});
