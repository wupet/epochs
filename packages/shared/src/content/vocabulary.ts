/**
 * The fixed choices of the content files, and the id spelling. No Zod in here: modules the client
 * can reach import these (`schemas.ts` re-exports them unchanged for everyone else).
 */

export const DAMAGE_KINDS = ['force', 'precision', 'arcane', 'holy'] as const;
export const ATTRIBUTES = ['might', 'finesse', 'vigor', 'wits', 'spirit'] as const;
export const CLASS_TIERS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
export const CAPACITY_COSTS = [1, 2, 3, 5] as const;
/** A class's capacity cost is fixed by its tier (Peter, 2026-11-19). */
export const TIER_CAPACITY_COST = { beginner: 1, intermediate: 2, advanced: 3, expert: 5 } as const satisfies Record<
  (typeof CLASS_TIERS)[number],
  (typeof CAPACITY_COSTS)[number]
>;
export const ABILITY_SHAPES = ['single-tile', 'line', 'cone', 'burst', 'wall', 'touch', 'self'] as const;
export const ITEM_KINDS = ['plain', 'trait', 'storied', 'holy-relic', 'cursed', 'consumable', 'tool'] as const;
export const ITEM_QUALITIES = ['crude', 'common', 'fine', 'superior', 'masterwork', 'legendary', 'mythic'] as const;
export const INTELLIGENCES = ['mindless', 'instinctive', 'cunning', 'organized', 'ancient'] as const;

/** Lowercase letters, digits and hyphens, starting with a letter. */
export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export type DamageKind = (typeof DAMAGE_KINDS)[number];
export type Attribute = (typeof ATTRIBUTES)[number];
