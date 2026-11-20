/**
 * The damage formula, in whole numbers. Pure, and reachable from the client, so it imports only
 * Zod-free modules (types are erased).
 */
import type { Attribute, DamageKind } from './content/vocabulary';
import type { Attributes } from './character';

/** Added damage per point of the matching attribute, in percent. */
export const ATTRIBUTE_BONUS_PERCENT = 4;
/** Added damage per level after the first, in percent. */
export const LEVEL_BONUS_PERCENT = 2;
/** The damage spread is a whole percent from minus this to plus this, rolled once per hit. */
export const SPREAD_PERCENT = 10;
/** Armor never takes more than the rest of the hit: at least this percent of it always gets through. */
export const ARMOR_FLOOR_PERCENT = 10;

/** Which attribute adds to each damage kind (holy follows spirit: builder call 10). */
export const ATTRIBUTE_FOR_KIND: Readonly<Record<DamageKind, Attribute>> = {
  force: 'might',
  precision: 'finesse',
  arcane: 'wits',
  holy: 'spirit',
};

const PERCENT = 100;
/** Resistances are multipliers such as 0.5 or 1.25; they become whole numbers in units of 1/10000. */
const RESISTANCE_SCALE = 10_000;
/** One whole point of damage, in the units of the integer sums below (percent x percent x resistance scale). */
const DAMAGE_SCALE = PERCENT * PERCENT * RESISTANCE_SCALE;

export interface DamageInput {
  /** What the hit is made of, per kind. */
  readonly damage: readonly { kind: DamageKind; amount: number }[];
  /** Who hits, for the attribute and level bonuses; `null` for an enemy, which deals its base amount. */
  readonly attacker: { attributes: Attributes; level: number } | null;
  /** The one spread roll of this hit, from -10 to +10 (`rollSpread`), used for every kind in it. */
  readonly spreadPercent: number;
  /** The target resistance multiplier per kind. A kind not listed counts as 1; 0 is immunity. */
  readonly resistances: readonly { kind: DamageKind; multiplier: number }[];
  /** The target flat armor. */
  readonly armor: number;
}

/**
 * How much health one hit takes. Per kind: amount x (100 + 4 x attribute + 2 x (level - 1)) x
 * (100 + spread) x resistance; the kinds add up; armor comes off once, but at least 10% of the hit
 * gets through; the result is rounded half up once and is at least 1 (except 0 when the target is
 * immune to every kind in the hit). Everything is a whole number until that last rounding.
 */
export function computeDamage(input: DamageInput): number {
  const { attacker, spreadPercent } = input;
  let sum = 0;
  let immuneToAll = true;
  for (const { kind, amount } of input.damage) {
    const bonus = attacker
      ? PERCENT +
        ATTRIBUTE_BONUS_PERCENT * attacker.attributes[ATTRIBUTE_FOR_KIND[kind]] +
        LEVEL_BONUS_PERCENT * (attacker.level - 1)
      : PERCENT;
    const listed = input.resistances.find((r) => r.kind === kind);
    const resistance = listed ? Math.round(listed.multiplier * RESISTANCE_SCALE) : RESISTANCE_SCALE;
    if (resistance !== 0) immuneToAll = false;
    sum += amount * bonus * (PERCENT + spreadPercent) * resistance;
  }
  if (immuneToAll) return 0;

  // In units of DAMAGE_SCALE x PERCENT, so the 10% floor stays whole.
  const afterArmor = (sum - input.armor * DAMAGE_SCALE) * PERCENT;
  const floor = sum * ARMOR_FLOOR_PERCENT;
  const net = Math.max(afterArmor, floor);
  const unit = DAMAGE_SCALE * PERCENT;
  const rounded = Math.floor((2 * net + unit) / (2 * unit));
  return Math.max(1, rounded);
}
