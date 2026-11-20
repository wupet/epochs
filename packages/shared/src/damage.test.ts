import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_FOR_KIND, computeDamage } from './index';
import type { DamageInput } from './index';

const attrs = (might: number, finesse = 1, wits = 1) => ({ might, finesse, vigor: 1, wits, spirit: 1 });
const SWORD = [
  { kind: 'force', amount: 4 },
  { kind: 'precision', amount: 2 },
] as const;
const SLIME_RES = [
  { kind: 'precision', multiplier: 0.5 },
  { kind: 'arcane', multiplier: 1.25 },
] as const;

function hit(overrides: Partial<DamageInput>): number {
  return computeDamage({
    damage: SWORD,
    attacker: { attributes: attrs(4, 1), level: 1 },
    spreadPercent: 0,
    resistances: [],
    armor: 0,
    ...overrides,
  });
}

describe('ATTRIBUTE_FOR_KIND', () => {
  it('pairs force with might, precision with finesse, arcane with wits, holy with spirit', () => {
    expect(ATTRIBUTE_FOR_KIND).toEqual({ force: 'might', precision: 'finesse', arcane: 'wits', holy: 'spirit' });
  });
});

describe('computeDamage', () => {
  it('shortsword against the slime: 6, 6, 5 for spread 0, +10, -10', () => {
    expect(hit({ resistances: SLIME_RES, spreadPercent: 0 })).toBe(6);
    expect(hit({ resistances: SLIME_RES, spreadPercent: 10 })).toBe(6);
    expect(hit({ resistances: SLIME_RES, spreadPercent: -10 })).toBe(5);
  });

  it('shortsword against the dummy (no resistances, no armor) is 7', () => {
    expect(hit({})).toBe(7);
  });

  it('bow and staff against the slime', () => {
    expect(
      hit({
        damage: [{ kind: 'precision', amount: 5 }],
        attacker: { attributes: attrs(1, 4), level: 1 },
        resistances: SLIME_RES,
      }),
    ).toBe(3);
    expect(
      hit({
        damage: [{ kind: 'arcane', amount: 3 }],
        attacker: { attributes: attrs(1, 1, 4), level: 1 },
        resistances: SLIME_RES,
      }),
    ).toBe(4);
  });

  it('level bonus adds in: Might 1, level 10 gives 7.32 -> 7', () => {
    expect(hit({ attacker: { attributes: attrs(1, 1), level: 10 } })).toBe(7);
  });

  it("the slime's touch (attacker null) against armor 1 is 2 at every spread", () => {
    for (const spreadPercent of [0, 10, -10]) {
      expect(hit({ damage: [{ kind: 'force', amount: 3 }], attacker: null, armor: 1, spreadPercent })).toBe(2);
    }
  });

  it('armor never takes more than 90% of the hit', () => {
    expect(hit({ damage: [{ kind: 'force', amount: 5 }], attacker: null, armor: 10 })).toBe(1);
    expect(hit({ damage: [{ kind: 'force', amount: 30 }], attacker: null, armor: 100 })).toBe(3);
  });

  it('rounds half up: force 5 against 0.5 is 3', () => {
    expect(
      hit({
        damage: [{ kind: 'force', amount: 5 }],
        attacker: null,
        resistances: [{ kind: 'force', multiplier: 0.5 }],
      }),
    ).toBe(3);
  });

  it('immunity: force 0 against F4 is 0; against F4 + P2 it is 2', () => {
    const immune = [{ kind: 'force', multiplier: 0 }] as const;
    expect(hit({ damage: [{ kind: 'force', amount: 4 }], attacker: null, resistances: immune })).toBe(0);
    expect(hit({ damage: SWORD, attacker: null, resistances: immune })).toBe(2);
  });

  it('immune to every kind in the hit takes 0 even with armor', () => {
    expect(
      hit({
        damage: [{ kind: 'force', amount: 4 }],
        attacker: null,
        armor: 3,
        resistances: [{ kind: 'force', multiplier: 0 }],
      }),
    ).toBe(0);
  });

  it('applies the spread as its own factor after the added bonuses', () => {
    // F10, Might 25, level 1: bonus factor 2.00. Multiplicative spread: 10 * 2.00 * 1.10 = 22, * 0.90 = 18.
    // An additive spread would give (200 + 10)% = 21 and (200 - 10)% = 19, so these pin the rule.
    const base = { damage: [{ kind: 'force', amount: 10 }] as const, attacker: { attributes: attrs(25), level: 1 } };
    expect(hit({ ...base, spreadPercent: 10 })).toBe(22);
    expect(hit({ ...base, spreadPercent: -10 })).toBe(18);
  });

  it('takes armor once from the summed kinds, not per kind', () => {
    // F4 + P4 = 8, armor 3 -> 5. Per kind it would be max(4 - 3, 10% of 4) twice = 2.
    expect(
      hit({
        damage: [
          { kind: 'force', amount: 4 },
          { kind: 'precision', amount: 4 },
        ],
        attacker: null,
        armor: 3,
      }),
    ).toBe(5);
  });

  it('rounds once on the sum, not per kind', () => {
    // F1 + P1, both resisted to 0.5: 0.5 + 0.5 = 1.0 -> 1. Rounding each half up first would give 2.
    expect(
      hit({
        damage: [
          { kind: 'force', amount: 1 },
          { kind: 'precision', amount: 1 },
        ],
        attacker: null,
        resistances: [
          { kind: 'force', multiplier: 0.5 },
          { kind: 'precision', multiplier: 0.5 },
        ],
      }),
    ).toBe(1);
  });
});
