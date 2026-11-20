/**
 * Schemas for the game's content files (`content/<kind>/<id>.json`). Every object is strict, so an
 * unknown field (a typo) is an error. Field names are camelCase; every fixed choice is lowercase with
 * hyphens; ids match `^[a-z][a-z0-9-]*$`.
 *
 * These schemas check the shape of one file. Rules that look inside a list (no repeats) or across
 * files (references, unique ids) live in `check.ts`.
 */
import { z } from 'zod';
import {
  ABILITY_SHAPES,
  ATTRIBUTES,
  CAPACITY_COSTS,
  CLASS_TIERS,
  DAMAGE_KINDS,
  ID_PATTERN,
  INTELLIGENCES,
  ITEM_KINDS,
  ITEM_QUALITIES,
} from './vocabulary';

// The fixed choices live in the Zod-free `vocabulary.ts`; everything importing this file still finds them here.
export * from './vocabulary';

const id = z.string().regex(ID_PATTERN);
const text = z.string().min(1);
const nonNegativeInt = z.int().min(0);
const nonNegativeNumber = z.number().min(0);
const positiveInt = z.int().min(1);

const damageKind = z.enum(DAMAGE_KINDS);
const damageAmount = z.strictObject({ kind: damageKind, amount: positiveInt });
/** Below 1 resists a damage kind, above 1 is a weakness, 0 is immunity (outside 0.25 to 3 the checker warns). */
const resistance = z.strictObject({ kind: damageKind, multiplier: nonNegativeNumber });
const tile = z.strictObject({ x: nonNegativeInt, y: nonNegativeInt });

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
  /** Present on weapons. A weapon also needs at least one damage kind in `damageSplit` (checked in `check.ts`). */
  weapon: z.strictObject({ attackIntervalTicks: positiveInt, rangeTiles: positiveInt }).optional(),
  /** Present on armor. */
  armor: z.strictObject({ armor: nonNegativeInt, resistances: z.array(resistance) }).optional(),
});

export const enemySchema = z.strictObject({
  id,
  name: text,
  family: text,
  tier: positiveInt,
  health: positiveInt,
  /** Millitiles per tick: 500 is a walk of one tile every 2 ticks, 2000 is 2 tiles per tick. */
  speed: z.int().min(0).max(2000),
  attacks: z.array(
    z.strictObject({
      id,
      name: text,
      /** At least 1: a 1-tick windup is positioning, not something a player can react to. */
      windupTicks: positiveInt,
      cooldownTicks: nonNegativeInt,
      damage: z.array(damageAmount).min(1),
    }),
  ),
  /** Ticks without being hit before the enemy heals to full. Absent means it never does. */
  healsAfterTicks: positiveInt.optional(),
  resistances: z.array(resistance),
  intelligence: z.enum(INTELLIGENCES),
});

export const presetSchema = z.strictObject({
  id,
  name: text,
  mainAttribute: z.enum(ATTRIBUTES),
  birthPoints: z.array(z.strictObject({ attribute: z.enum(ATTRIBUTES), points: positiveInt })),
  weapon: id.nullable(),
  armor: id.nullable(),
});

export const arenaSchema = z.strictObject({
  id,
  name: text,
  /** One string per row, top to bottom: `#` is a wall, `.` is floor. */
  rows: z.array(z.string()).min(1),
  campfire: tile,
  spawn: tile,
  startingPreset: id,
});

export const waveSchema = z.strictObject({
  id,
  name: text,
  arena: id,
  enemies: z.array(z.strictObject({ enemy: id, x: nonNegativeInt, y: nonNegativeInt })).min(1),
});

export type ClassContent = z.infer<typeof classSchema>;
export type AbilityContent = z.infer<typeof abilitySchema>;
export type ItemContent = z.infer<typeof itemSchema>;
export type EnemyContent = z.infer<typeof enemySchema>;
export type PresetContent = z.infer<typeof presetSchema>;
export type ArenaContent = z.infer<typeof arenaSchema>;
export type WaveContent = z.infer<typeof waveSchema>;

/** The folder name under `content/` for each kind, and the schema its files must satisfy. */
export const CONTENT_KINDS = {
  classes: classSchema,
  abilities: abilitySchema,
  items: itemSchema,
  enemies: enemySchema,
  presets: presetSchema,
  arenas: arenaSchema,
  waves: waveSchema,
} as const;

export type ContentKind = keyof typeof CONTENT_KINDS;
