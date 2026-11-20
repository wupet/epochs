import { describe, expect, it } from 'vitest';
import {
  abilitySchema,
  arenaSchema,
  ATTRIBUTES,
  classSchema,
  CONTENT_KINDS,
  DAMAGE_KINDS,
  enemySchema,
  itemSchema,
  presetSchema,
  waveSchema,
} from './schemas';
import * as schemas from './schemas';
import * as vocabulary from './vocabulary';

const militia = {
  id: 'militia',
  name: 'Militia',
  tier: 'beginner',
  capacityCost: 1,
  prerequisites: [],
  unlockCondition: 'Hold a gate until a raid ends.',
  signaturePassive: { id: 'steady-guard', description: 'Draft: hold your ground.' },
  startingAbilities: ['basic-strike'],
  capstone: 'Draft: allies nearby stand firm.',
};
const basicStrike = {
  id: 'basic-strike',
  name: 'Basic Strike',
  channelTicks: 1,
  shape: 'single-tile',
  rangeTiles: 1,
  damage: [{ kind: 'force', amount: 4 }],
  conditionsApplied: [],
};
const rustyShortsword = {
  id: 'rusty-shortsword',
  name: 'Rusty Shortsword',
  kind: 'plain',
  quality: 'crude',
  damageSplit: [
    { kind: 'force', amount: 3 },
    { kind: 'precision', amount: 1 },
  ],
  requirements: [{ attribute: 'might', minimum: 1 }],
};
const slime = {
  id: 'slime',
  name: 'Slime',
  family: 'slime',
  tier: 1,
  health: 10,
  speed: 500,
  attacks: [{ id: 'touch', name: 'Touch', windupTicks: 1, cooldownTicks: 3, damage: [{ kind: 'force', amount: 1 }] }],
  resistances: [{ kind: 'precision', multiplier: 0.5 }],
  intelligence: 'mindless',
};

describe('content schemas', () => {
  it('names the damage kinds and attributes', () => {
    expect(DAMAGE_KINDS).toEqual(['force', 'precision', 'arcane', 'holy']);
    expect(ATTRIBUTES).toEqual(['might', 'finesse', 'vigor', 'wits', 'spirit']);
  });

  it('maps each folder to its schema', () => {
    expect(CONTENT_KINDS).toEqual({
      classes: classSchema,
      abilities: abilitySchema,
      items: itemSchema,
      enemies: enemySchema,
      presets: presetSchema,
      arenas: arenaSchema,
      waves: waveSchema,
    });
  });

  it('re-exports the vocabulary unchanged', () => {
    for (const [name, value] of Object.entries(vocabulary)) expect(schemas).toHaveProperty(name, value);
  });

  it('accepts the four samples', () => {
    expect(classSchema.safeParse(militia).success).toBe(true);
    expect(abilitySchema.safeParse(basicStrike).success).toBe(true);
    expect(itemSchema.safeParse(rustyShortsword).success).toBe(true);
    expect(enemySchema.safeParse(slime).success).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(classSchema.safeParse({ ...militia, colour: 'red' }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, attacks: [{ ...slime.attacks[0], extra: 1 }] }).success).toBe(false);
  });

  it('only accepts capacity costs 1, 2, 3 and 5', () => {
    for (const ok of [1, 2, 3, 5]) expect(classSchema.safeParse({ ...militia, capacityCost: ok }).success).toBe(true);
    for (const bad of [0, 4, 6, '1']) expect(classSchema.safeParse({ ...militia, capacityCost: bad }).success).toBe(false);
  });

  it('requires ids to be lowercase with hyphens', () => {
    for (const bad of ['Militia', '1militia', 'mili tia', 'mili_tia', '']) {
      expect(classSchema.safeParse({ ...militia, id: bad }).success).toBe(false);
    }
    expect(classSchema.safeParse({ ...militia, id: 'old-militia-2' }).success).toBe(true);
  });

  it('requires a non-empty capstone and unlock condition', () => {
    expect(classSchema.safeParse({ ...militia, capstone: '' }).success).toBe(false);
    expect(classSchema.safeParse({ ...militia, unlockCondition: '' }).success).toBe(false);
  });

  it('checks number bounds', () => {
    expect(classSchema.safeParse({ ...militia, prerequisites: [{ classId: 'x', rank: 0 }] }).success).toBe(false);
    expect(abilitySchema.safeParse({ ...basicStrike, channelTicks: -1 }).success).toBe(false);
    expect(abilitySchema.safeParse({ ...basicStrike, channelTicks: 0 }).success).toBe(true);
    expect(abilitySchema.safeParse({ ...basicStrike, rangeTiles: 1.5 }).success).toBe(false);
    expect(abilitySchema.safeParse({ ...basicStrike, damage: [{ kind: 'force', amount: 0 }] }).success).toBe(false);
    expect(itemSchema.safeParse({ ...rustyShortsword, requirements: [{ attribute: 'might', minimum: 0 }] }).success).toBe(true);
    expect(itemSchema.safeParse({ ...rustyShortsword, damageSplit: [] }).success).toBe(true);
    expect(enemySchema.safeParse({ ...slime, tier: 0 }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, health: 0 }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, resistances: [{ kind: 'force', multiplier: 0 }] }).success).toBe(true);
    expect(enemySchema.safeParse({ ...slime, resistances: [{ kind: 'force', multiplier: -0.1 }] }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, speed: 2000 }).success).toBe(true);
    expect(enemySchema.safeParse({ ...slime, speed: 2001 }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, speed: -1 }).success).toBe(false);
    expect(enemySchema.safeParse({ ...slime, resistances: [{ kind: 'force', multiplier: 1.5 }] }).success).toBe(true);
  });

  it('rejects choices that are not lowercase-with-hyphens spellings', () => {
    expect(itemSchema.safeParse({ ...rustyShortsword, kind: 'holy_relic' }).success).toBe(false);
    expect(itemSchema.safeParse({ ...rustyShortsword, kind: 'holy-relic' }).success).toBe(true);
    expect(abilitySchema.safeParse({ ...basicStrike, shape: 'singleTile' }).success).toBe(false);
  });
});
