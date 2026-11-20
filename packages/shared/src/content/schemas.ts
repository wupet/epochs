/**
 * Schemas for the game's content files (`content/<kind>/<id>.json`). Every object is strict, so an
 * unknown field (a typo) is an error. Field names are camelCase; every fixed choice is lowercase with
 * hyphens; ids match `^[a-z][a-z0-9-]*$`.
 *
 * These schemas check the shape of one file. Rules that look inside a list (no repeats) or across
 * files (references, unique ids) live in `check.ts`.
 */
import { z } from 'zod';

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

const id = z.string().regex(ID_PATTERN);
const text = z.string().min(1);
const nonNegativeInt = z.int().min(0);
const positiveInt = z.int().min(1);

const damageKind = z.enum(DAMAGE_KINDS);
const damageAmount = z.strictObject({ kind: damageKind, amount: positiveInt });

export const classSchema = z.strictObject({
  id,
  name: text,
  tier: z.enum(CLASS_TIERS),
  capacityCost: z.literal(CAPACITY_COSTS),
  prerequisites: z.array(z.strictObject({ classId: id, rank: positiveInt })),
  unlockCondition: text,
  signaturePassive: z.strictObject({ id, description: text }),
  startingAbilities: z.array(id),
  /** A short description of the class's bonus at full mastery. */
  capstone: text,
});

export const abilitySchema = z.strictObject({
  id,
  name: text,
  channelTicks: nonNegativeInt,
  shape: z.enum(ABILITY_SHAPES),
  rangeTiles: nonNegativeInt,
  damage: z.array(damageAmount),
  conditionsApplied: z.array(text),
});

export const itemSchema = z.strictObject({
  id,
  name: text,
  kind: z.enum(ITEM_KINDS),
  quality: z.enum(ITEM_QUALITIES),
  damageSplit: z.array(damageAmount),
  requirements: z.array(z.strictObject({ attribute: z.enum(ATTRIBUTES), minimum: nonNegativeInt })),
});

export const enemySchema = z.strictObject({
  id,
  name: text,
  family: text,
  tier: positiveInt,
  health: positiveInt,
  damage: z.array(damageAmount),
  /** Below 1 resists a damage kind, above 1 is a weakness. */
  resistances: z.array(z.strictObject({ kind: damageKind, multiplier: z.number().positive() })),
  intelligence: z.enum(INTELLIGENCES),
});

export type ClassContent = z.infer<typeof classSchema>;
export type AbilityContent = z.infer<typeof abilitySchema>;
export type ItemContent = z.infer<typeof itemSchema>;
export type EnemyContent = z.infer<typeof enemySchema>;

/** The folder name under `content/` for each kind, and the schema its files must satisfy. */
export const CONTENT_KINDS = {
  classes: classSchema,
  abilities: abilitySchema,
  items: itemSchema,
  enemies: enemySchema,
} as const;

export type ContentKind = keyof typeof CONTENT_KINDS;
