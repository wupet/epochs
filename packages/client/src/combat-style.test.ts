import { describe, expect, it } from 'vitest';
import { FLOAT_MS } from './floating-numbers';
import { enemyColor, floatRise, healthFraction, showsHealthBar, telegraphColor } from './combat-style';

describe('combat style', () => {
  it('colours enemies by family', () => {
    expect(enemyColor('slime')).toBe(0x6fcf6f);
    expect(enemyColor('construct')).toBe(0xa08060);
    expect(enemyColor('beast')).toBe(0xd05050);
    expect(enemyColor('')).toBe(0xd05050);
  });

  it('colours telegraphs by damage kind, and survives a hostile kind', () => {
    expect(telegraphColor('force')).toBe(0xe07a3a);
    expect(telegraphColor('precision')).toBe(0xe0d24a);
    expect(telegraphColor('arcane')).toBe(0xa070ff);
    expect(telegraphColor('holy')).toBe(0xf5f5dc);
    expect(telegraphColor('constructor')).toBe(0xffffff);
  });

  it('shows enemy health bars always and player health bars only when hurt', () => {
    expect(showsHealthBar(true, 10, 10)).toBe(true);
    expect(showsHealthBar(false, 10, 10)).toBe(false);
    expect(showsHealthBar(false, 9, 10)).toBe(true);
    expect(showsHealthBar(false, 0, 10)).toBe(true);
    expect(showsHealthBar(true, 0, 0)).toBe(false);
  });

  it('keeps the health fraction between 0 and 1', () => {
    expect(healthFraction(5, 10)).toBe(0.5);
    expect(healthFraction(-3, 10)).toBe(0);
    expect(healthFraction(30, 10)).toBe(1);
    expect(healthFraction(5, 0)).toBe(0);
  });

  it('raises a number 0.6 tiles over FLOAT_MS', () => {
    expect(floatRise(0)).toBe(0);
    expect(floatRise(FLOAT_MS / 2)).toBeCloseTo(0.3);
    expect(floatRise(FLOAT_MS)).toBeCloseTo(0.6);
    expect(floatRise(FLOAT_MS * 3)).toBeCloseTo(0.6);
  });
});
