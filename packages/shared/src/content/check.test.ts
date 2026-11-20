import { describe, expect, it } from 'vitest';
import { checkContent, formatProblem } from './check';
import type { ContentFile } from './check';

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
  weapon: { attackIntervalTicks: 4, rangeTiles: 1 },
};
const leatherJerkin = {
  id: 'leather-jerkin',
  name: 'Leather Jerkin',
  kind: 'plain',
  quality: 'crude',
  damageSplit: [],
  requirements: [],
  armor: { armor: 1, resistances: [] },
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
const militiaPreset = {
  id: 'militia',
  name: 'Militia',
  mainAttribute: 'might',
  birthPoints: [
    { attribute: 'might', points: 3 },
    { attribute: 'vigor', points: 1 },
  ],
  weapon: 'rusty-shortsword',
  armor: 'leather-jerkin',
};
// A 5 by 5 room with a pillar; the campfire is at (2, 3) and the spawn tile at (1, 3).
const arena = {
  id: 'arena',
  name: 'Arena',
  rows: ['#####', '#...#', '#.#.#', '#...#', '#####'],
  campfire: { x: 2, y: 3 },
  spawn: { x: 1, y: 3 },
  startingPreset: 'militia',
};
const wave = {
  id: 'wave-1',
  name: 'Wave 1',
  arena: 'arena',
  enemies: [
    { enemy: 'slime', x: 1, y: 1 },
    { enemy: 'slime', x: 3, y: 1 },
  ],
};

const file = (path: string, value: unknown): ContentFile => ({ path, text: JSON.stringify(value) });
const samples = (): ContentFile[] => [
  file('content/classes/militia.json', militia),
  file('content/abilities/basic-strike.json', basicStrike),
  file('content/items/rusty-shortsword.json', rustyShortsword),
  file('content/enemies/slime.json', slime),
  file('content/items/leather-jerkin.json', leatherJerkin),
  file('content/presets/militia.json', militiaPreset),
  file('content/arenas/arena.json', arena),
  file('content/waves/wave-1.json', wave),
];
const strikeFile = file('content/abilities/basic-strike.json', basicStrike);

describe('checkContent', () => {
  it('accepts a fully valid set, one or more of every kind', () => {
    expect(checkContent(samples())).toEqual([]);
  });

  it('accepts an empty set', () => {
    expect(checkContent([])).toEqual([]);
  });

  it('says "required" for a missing enum field, not "expected one of"', () => {
    const { kind: _kind, ...withoutKind } = rustyShortsword;
    const problems = checkContent([file('content/items/rusty-shortsword.json', withoutKind)]);
    expect(problems).toEqual([{ file: 'content/items/rusty-shortsword.json', field: 'kind', severity: 'error', message: 'required' }]);
  });

  it('reports only the broken file when one is broken and one is valid (review focus 4)', () => {
    const broken = file('content/items/bad.json', { ...rustyShortsword, id: 'bad', kind: 'shiny' });
    expect(checkContent([strikeFile, broken])).toEqual([
      {
        file: 'content/items/bad.json',
        field: 'kind',
        severity: 'error', message: 'expected one of plain, trait, storied, holy-relic, cursed, consumable, tool',
      },
    ]);
  });

  it('rejects an unknown choice', () => {
    const bad = file('content/items/rusty-shortsword.json', {
      ...rustyShortsword,
      damageSplit: [
        { kind: 'force', amount: 3 },
        { kind: 'fire', amount: 1 },
      ],
    });
    expect(checkContent([bad])).toEqual([
      {
        file: 'content/items/rusty-shortsword.json',
        field: 'damageSplit[1].kind',
        severity: 'error', message: 'expected one of force, precision, arcane, holy',
      },
    ]);
  });

  it('rejects a missing field', () => {
    const { capstone: _capstone, ...withoutCapstone } = militia;
    expect(checkContent([file('content/classes/militia.json', withoutCapstone), strikeFile])).toEqual([
      { file: 'content/classes/militia.json', field: 'capstone', severity: 'error', message: 'required' },
    ]);
  });

  it('rejects an extra field', () => {
    const bad = file('content/abilities/basic-strike.json', { ...basicStrike, rangeTile: 2 });
    expect(checkContent([bad])).toEqual([
      { file: 'content/abilities/basic-strike.json', field: 'rangeTile', severity: 'error', message: 'unknown field' },
    ]);
  });

  it('reports each extra field on its own, with the path to the key', () => {
    const bad = file('content/enemies/slime.json', {
      ...slime,
      resistances: [{ kind: 'force', multiplier: 1, colour: 'red', size: 2 }],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/enemies/slime.json', field: 'resistances[0].colour', severity: 'error', message: 'unknown field' },
      { file: 'content/enemies/slime.json', field: 'resistances[0].size', severity: 'error', message: 'unknown field' },
    ]);
  });

  it('rejects invalid JSON', () => {
    const problems = checkContent([{ path: 'content/items/oops.json', text: '{ "id": "oops", ' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: 'content/items/oops.json', field: '' });
    expect(problems[0]!.message).toMatch(/^invalid JSON: ./);
  });

  it('rejects the wrong type', () => {
    expect(checkContent([file('content/enemies/slime.json', { ...slime, name: 7 })])).toEqual([
      { file: 'content/enemies/slime.json', field: 'name', severity: 'error', message: 'expected string' },
    ]);
  });

  it('rejects a JSON file that is not an object', () => {
    expect(checkContent([{ path: 'content/enemies/slime.json', text: '[]' }])).toEqual([
      { file: 'content/enemies/slime.json', field: '', severity: 'error', message: 'expected object' },
    ]);
  });

  it('says whole numbers and bounds in plain words', () => {
    const bad = file('content/abilities/basic-strike.json', {
      ...basicStrike,
      channelTicks: -1,
      rangeTiles: 1.5,
      damage: [{ kind: 'force', amount: 0 }],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/abilities/basic-strike.json', field: 'channelTicks', severity: 'error', message: 'must be at least 0' },
      { file: 'content/abilities/basic-strike.json', field: 'damage[0].amount', severity: 'error', message: 'must be at least 1' },
      { file: 'content/abilities/basic-strike.json', field: 'rangeTiles', severity: 'error', message: 'must be a whole number' },
    ]);
  });

  it('says a multiplier must not be below 0', () => {
    const bad = file('content/enemies/slime.json', { ...slime, resistances: [{ kind: 'force', multiplier: -0.5 }] });
    expect(checkContent([bad])).toEqual([
      { file: 'content/enemies/slime.json', field: 'resistances[0].multiplier', severity: 'error', message: 'must be at least 0' },
    ]);
  });

  it('rejects a bad id spelling', () => {
    const bad = file('content/classes/Militia.json', { ...militia, id: 'Militia' });
    expect(checkContent([bad])).toEqual([
      { file: 'content/classes/Militia.json', field: 'id', severity: 'error', message: expect.stringContaining('lowercase') },
    ]);
  });

  it('rejects an id that does not match the file name', () => {
    const bad = file('content/items/rusty-shortsword.json', { ...rustyShortsword, id: 'shiny-sword' });
    expect(checkContent([bad])).toEqual([
      { file: 'content/items/rusty-shortsword.json', field: 'id', severity: 'error', message: 'must match the file name "rusty-shortsword"' },
    ]);
  });

  it('rejects a duplicate id, on each file after the first', () => {
    const problems = checkContent([
      file('content/items/b.json', { ...rustyShortsword, id: 'a' }),
      file('content/items/a.json', { ...rustyShortsword, id: 'a' }),
      file('content/items/c.json', { ...rustyShortsword, id: 'a' }),
    ]);
    expect(problems).toEqual([
      { file: 'content/items/b.json', field: 'id', severity: 'error', message: 'duplicate id, also used by content/items/a.json' },
      { file: 'content/items/b.json', field: 'id', severity: 'error', message: 'must match the file name "b"' },
      { file: 'content/items/c.json', field: 'id', severity: 'error', message: 'duplicate id, also used by content/items/a.json' },
      { file: 'content/items/c.json', field: 'id', severity: 'error', message: 'must match the file name "c"' },
    ]);
  });

  it('lets two kinds share an id', () => {
    const problems = checkContent([
      file('content/items/slime.json', { ...rustyShortsword, id: 'slime' }),
      file('content/enemies/slime.json', slime),
    ]);
    expect(problems).toEqual([]);
  });

  it('rejects a starting ability that does not exist', () => {
    const problems = checkContent([
      file('content/classes/militia.json', { ...militia, startingAbilities: ['basic-strike', 'fireball'] }),
      strikeFile,
    ]);
    expect(problems).toEqual([
      { file: 'content/classes/militia.json', field: 'startingAbilities[1]', severity: 'error', message: 'no ability with id "fireball"' },
    ]);
  });

  it('rejects a prerequisite class that does not exist', () => {
    const knight = file('content/classes/knight.json', {
      ...militia,
      id: 'knight',
      prerequisites: [{ classId: 'ghost', rank: 2 }],
    });
    expect(checkContent([...samples(), knight])).toEqual([
      { file: 'content/classes/knight.json', field: 'prerequisites[0].classId', severity: 'error', message: 'no class with id "ghost"' },
    ]);
  });

  it('accepts a prerequisite class that exists', () => {
    const knight = file('content/classes/knight.json', {
      ...militia,
      id: 'knight',
      prerequisites: [{ classId: 'militia', rank: 2 }],
    });
    expect(checkContent([...samples(), knight])).toEqual([]);
  });

  it('rejects a class that requires itself', () => {
    const knight = file('content/classes/knight.json', {
      ...militia,
      id: 'knight',
      prerequisites: [{ classId: 'knight', rank: 1 }],
    });
    expect(checkContent([...samples(), knight])).toEqual([
      { file: 'content/classes/knight.json', field: 'prerequisites[0].classId', severity: 'error', message: "a class can't require itself" },
    ]);
  });

  it('skips cross-references for files that failed validation', () => {
    // militia has a bad tier, so its missing ability is not reported on top of it.
    const problems = checkContent([file('content/classes/militia.json', { ...militia, tier: 'novice' })]);
    expect(problems.map((p) => [p.file, p.field])).toEqual([['content/classes/militia.json', 'tier']]);
  });

  it('does not count a file that failed validation as a target', () => {
    const problems = checkContent([
      file('content/classes/militia.json', militia),
      file('content/abilities/basic-strike.json', { ...basicStrike, shape: 'blob' }),
    ]);
    expect(problems.map((p) => [p.file, p.field])).toEqual([
      ['content/abilities/basic-strike.json', 'shape'],
      ['content/classes/militia.json', 'startingAbilities[0]'],
    ]);
  });

  it('rejects a repeated damage kind', () => {
    const bad = file('content/abilities/basic-strike.json', {
      ...basicStrike,
      damage: [
        { kind: 'force', amount: 2 },
        { kind: 'arcane', amount: 1 },
        { kind: 'force', amount: 1 },
      ],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/abilities/basic-strike.json', field: 'damage[2].kind', severity: 'error', message: 'repeated damage kind "force"' },
    ]);
  });

  it('rejects a repeated resistance kind', () => {
    const bad = file('content/enemies/slime.json', {
      ...slime,
      resistances: [
        { kind: 'precision', multiplier: 0.5 },
        { kind: 'precision', multiplier: 0.7 },
      ],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/enemies/slime.json', field: 'resistances[1].kind', severity: 'error', message: 'repeated damage kind "precision"' },
    ]);
  });

  it('rejects a repeated requirement attribute', () => {
    const bad = file('content/items/rusty-shortsword.json', {
      ...rustyShortsword,
      requirements: [
        { attribute: 'might', minimum: 1 },
        { attribute: 'might', minimum: 2 },
      ],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/items/rusty-shortsword.json', field: 'requirements[1].attribute', severity: 'error', message: 'repeated attribute "might"' },
    ]);
  });

  it('rejects a repeated prerequisite class and a repeated starting ability', () => {
    const knight = file('content/classes/knight.json', {
      ...militia,
      id: 'knight',
      prerequisites: [
        { classId: 'militia', rank: 1 },
        { classId: 'militia', rank: 2 },
      ],
      startingAbilities: ['basic-strike', 'basic-strike'],
    });
    expect(checkContent([...samples(), knight])).toEqual([
      { file: 'content/classes/knight.json', field: 'prerequisites[1].classId', severity: 'error', message: 'repeated prerequisite class "militia"' },
      { file: 'content/classes/knight.json', field: 'startingAbilities[1]', severity: 'error', message: 'repeated starting ability "basic-strike"' },
    ]);
  });

  it('rejects 3 damage kinds on an item', () => {
    const bad = file('content/items/rusty-shortsword.json', {
      ...rustyShortsword,
      damageSplit: [
        { kind: 'force', amount: 3 },
        { kind: 'precision', amount: 1 },
        { kind: 'holy', amount: 1 },
      ],
    });
    expect(checkContent([bad])).toEqual([
      {
        file: 'content/items/rusty-shortsword.json',
        field: 'damageSplit',
        severity: 'error', message: 'at most 2 damage kinds allowed, found 3',
      },
    ]);
  });

  it('rejects an unknown folder', () => {
    expect(checkContent([file('content/spells/fireball.json', basicStrike)])).toEqual([
      {
        file: 'content/spells/fireball.json',
        field: '',
        severity: 'error', message: 'unknown content folder "spells" (expected classes, abilities, items, enemies, presets, arenas, waves)',
      },
    ]);
  });

  it('rejects a file that is not .json', () => {
    expect(checkContent([{ path: 'content/items/notes.txt', text: 'hello' }])).toEqual([
      { file: 'content/items/notes.txt', field: '', severity: 'error', message: 'not a .json file' },
    ]);
  });

  it('rejects paths that are not content/<kind>/<name>.json', () => {
    const problems = checkContent([
      { path: 'other/items/a.json', text: '{}' },
      { path: 'content/a.json', text: '{}' },
      { path: 'content/items/deep/a.json', text: '{}' },
    ]);
    expect(problems.map((p) => [p.file, p.field])).toEqual([
      ['content/a.json', ''],
      ['content/items/deep/a.json', ''],
      ['other/items/a.json', ''],
    ]);
    for (const p of problems) expect(p.message).toContain('content/<kind>/<name>.json');
  });

  it('accepts each tier with its fixed capacity cost', () => {
    const costs = { beginner: 1, intermediate: 2, advanced: 3, expert: 5 } as const;
    for (const [tier, capacityCost] of Object.entries(costs)) {
      expect(checkContent([file('content/classes/militia.json', { ...militia, tier, capacityCost }), strikeFile])).toEqual([]);
    }
  });

  it('rejects a capacity cost that does not match the tier', () => {
    const bad = file('content/classes/militia.json', { ...militia, tier: 'advanced', capacityCost: 2 });
    expect(checkContent([bad, strikeFile])).toEqual([
      { file: 'content/classes/militia.json', field: 'capacityCost', severity: 'error', message: 'must be 3 for an advanced class' },
    ]);
  });

  it('uses "a" or "an" to suit the tier in the capacity cost message', () => {
    const wrong = { beginner: 2, intermediate: 1, advanced: 1, expert: 1 } as const;
    const messages = Object.entries(wrong).map(([tier, capacityCost]) =>
      checkContent([file('content/classes/militia.json', { ...militia, tier, capacityCost }), strikeFile])[0]!.message,
    );
    expect(messages).toEqual([
      'must be 1 for a beginner class',
      'must be 2 for an intermediate class',
      'must be 3 for an advanced class',
      'must be 5 for an expert class',
    ]);
  });

  it('warns, without failing, about a resistance multiplier below 0.25 or above 3', () => {
    const odd = file('content/enemies/slime.json', {
      ...slime,
      resistances: [
        { kind: 'precision', multiplier: 0.2 },
        { kind: 'force', multiplier: 4 },
      ],
    });
    expect(checkContent([odd])).toEqual([
      { file: 'content/enemies/slime.json', field: 'resistances[0].multiplier', severity: 'warning', message: '0.2 is outside the usual range 0.25–3' },
      { file: 'content/enemies/slime.json', field: 'resistances[1].multiplier', severity: 'warning', message: '4 is outside the usual range 0.25–3' },
    ]);
  });

  it('does not warn at the boundaries 0.25 and 3', () => {
    const edge = file('content/enemies/slime.json', {
      ...slime,
      resistances: [
        { kind: 'precision', multiplier: 0.25 },
        { kind: 'force', multiplier: 3 },
      ],
    });
    expect(checkContent([edge])).toEqual([]);
  });

  it('does not warn about multipliers on an enemy that failed validation', () => {
    const bad = file('content/enemies/slime.json', { ...slime, health: 0, resistances: [{ kind: 'force', multiplier: 9 }] });
    expect(checkContent([bad]).map((p) => p.severity)).toEqual(['error']);
  });

  it('sorts problems by file, then field, then message', () => {
    const problems = checkContent([
      file('content/items/z.json', { ...rustyShortsword, id: 'z', kind: 'shiny', quality: 'poor' }),
      file('content/items/a.json', { ...rustyShortsword, id: 'a', name: 5 }),
      { path: 'content/items/m.json', text: 'nope' },
    ]);
    expect(problems.map((p) => [p.file, p.field])).toEqual([
      ['content/items/a.json', 'name'],
      ['content/items/m.json', ''],
      ['content/items/z.json', 'kind'],
      ['content/items/z.json', 'quality'],
    ]);
  });

  it('is not affected by input order', () => {
    const files = [...samples(), file('content/classes/knight.json', { ...militia, id: 'knight', startingAbilities: ['nope'] })];
    expect(checkContent([...files].reverse())).toEqual(checkContent(files));
  });
});

const err = (path: string, field: string, message: string) => ({ file: path, field, severity: 'error' as const, message });

describe('combat content rules', () => {
  const slimePath = 'content/enemies/slime.json';
  const swordPath = 'content/items/rusty-shortsword.json';
  const jerkinPath = 'content/items/leather-jerkin.json';
  const presetPath = 'content/presets/militia.json';
  const arenaPath = 'content/arenas/arena.json';
  const wavePath = 'content/waves/wave-1.json';
  const touch = slime.attacks[0]!;

  /**
   * The problems in one file. A file that fails its shape check is left out of the cross-file checks, so
   * files that refer to it get "no ... with id" errors too; tests about the shape look at their file only.
   */
  const own = (path: string, files: ContentFile[]) => checkContent(files).filter((p) => p.file === path);

  /** The valid set with one file replaced by a changed version. */
  const changed = (path: string, value: unknown): ContentFile[] =>
    samples().map((f) => (f.path === path ? file(path, value) : f));

  describe('resistances', () => {
    it('warns about a 0 multiplier on an enemy, without an error', () => {
      const odd = changed(slimePath, { ...slime, resistances: [{ kind: 'force', multiplier: 0 }] });
      expect(checkContent(odd)).toEqual([
        { file: slimePath, field: 'resistances[0].multiplier', severity: 'warning', message: '0 is outside the usual range 0.25–3' },
      ]);
    });

    it('warns about a 0 multiplier and an odd one on armor, at armor.resistances', () => {
      const odd = changed(jerkinPath, {
        ...leatherJerkin,
        armor: { armor: 1, resistances: [{ kind: 'force', multiplier: 0 }, { kind: 'holy', multiplier: 4 }] },
      });
      expect(checkContent(odd)).toEqual([
        { file: jerkinPath, field: 'armor.resistances[0].multiplier', severity: 'warning', message: '0 is outside the usual range 0.25–3' },
        { file: jerkinPath, field: 'armor.resistances[1].multiplier', severity: 'warning', message: '4 is outside the usual range 0.25–3' },
      ]);
    });

    it('rejects a negative multiplier on armor', () => {
      const bad = changed(jerkinPath, { ...leatherJerkin, armor: { armor: 1, resistances: [{ kind: 'force', multiplier: -0.5 }] } });
      expect(own(jerkinPath, bad)).toEqual([err(jerkinPath, 'armor.resistances[0].multiplier', 'must be at least 0')]);
    });

    it('rejects a repeated armor resistance kind', () => {
      const bad = changed(jerkinPath, {
        ...leatherJerkin,
        armor: { armor: 1, resistances: [{ kind: 'force', multiplier: 0.5 }, { kind: 'force', multiplier: 0.6 }] },
      });
      expect(checkContent(bad)).toEqual([err(jerkinPath, 'armor.resistances[1].kind', 'repeated damage kind "force"')]);
    });
  });

  describe('enemies', () => {
    it('rejects a repeated attack id', () => {
      const bad = changed(slimePath, { ...slime, attacks: [touch, { ...touch, name: 'Again' }] });
      expect(checkContent(bad)).toEqual([err(slimePath, 'attacks[1].id', 'repeated attack id "touch"')]);
    });

    it('rejects a repeated damage kind within an attack', () => {
      const bad = changed(slimePath, {
        ...slime,
        attacks: [{ ...touch, damage: [{ kind: 'force', amount: 1 }, { kind: 'arcane', amount: 1 }, { kind: 'force', amount: 2 }] }],
      });
      expect(checkContent(bad)).toEqual([err(slimePath, 'attacks[0].damage[2].kind', 'repeated damage kind "force"')]);
    });

    it('accepts an enemy with no attacks and a healing delay', () => {
      const dummy = { ...slime, attacks: [], speed: 0, healsAfterTicks: 20 };
      expect(checkContent(changed(slimePath, dummy))).toEqual([]);
    });

    it('rejects a speed above 2000, a zero windup and a zero healing delay', () => {
      const bad = changed(slimePath, { ...slime, speed: 2001, attacks: [{ ...touch, windupTicks: 0 }], healsAfterTicks: 0 });
      expect(own(slimePath, bad)).toEqual([
        err(slimePath, 'attacks[0].windupTicks', 'must be at least 1'),
        err(slimePath, 'healsAfterTicks', 'must be at least 1'),
        err(slimePath, 'speed', 'must be at most 2000'),
      ]);
    });

    it('rejects the old damage field', () => {
      const bad = changed(slimePath, { ...slime, damage: [{ kind: 'force', amount: 1 }] });
      expect(own(slimePath, bad)).toEqual([err(slimePath, 'damage', 'unknown field')]);
    });
  });

  describe('items', () => {
    it('rejects a weapon with an empty damage split', () => {
      const bad = changed(swordPath, { ...rustyShortsword, damageSplit: [] });
      expect(checkContent(bad)).toEqual([err(swordPath, 'damageSplit', 'a weapon needs at least 1 damage kind')]);
    });

    it('rejects a weapon interval or range below 1', () => {
      const bad = changed(swordPath, { ...rustyShortsword, weapon: { attackIntervalTicks: 0, rangeTiles: 0 } });
      expect(own(swordPath, bad)).toEqual([
        err(swordPath, 'weapon.attackIntervalTicks', 'must be at least 1'),
        err(swordPath, 'weapon.rangeTiles', 'must be at least 1'),
      ]);
    });
  });

  describe('presets', () => {
    it.each([3, 5])('rejects birth points totalling %i', (total) => {
      const bad = changed(presetPath, {
        ...militiaPreset,
        birthPoints: [{ attribute: 'might', points: total - 1 }, { attribute: 'vigor', points: 1 }],
      });
      expect(checkContent(bad)).toEqual([err(presetPath, 'birthPoints', `must total 4, found ${total}`)]);
    });

    it('rejects a repeated birth-point attribute', () => {
      const bad = changed(presetPath, {
        ...militiaPreset,
        birthPoints: [{ attribute: 'might', points: 2 }, { attribute: 'might', points: 2 }],
      });
      expect(checkContent(bad)).toEqual([err(presetPath, 'birthPoints[1].attribute', 'repeated attribute "might"')]);
    });

    it('rejects birth points below 1', () => {
      const bad = changed(presetPath, { ...militiaPreset, birthPoints: [{ attribute: 'might', points: 0 }] });
      expect(own(presetPath, bad)).toEqual([err(presetPath, 'birthPoints[0].points', 'must be at least 1')]);
    });

    it('rejects a weapon that is not a weapon, an armor that is not armor, and unknown ids', () => {
      expect(checkContent(changed(presetPath, { ...militiaPreset, weapon: 'leather-jerkin' }))).toEqual([
        err(presetPath, 'weapon', '"leather-jerkin" is not a weapon'),
      ]);
      expect(checkContent(changed(presetPath, { ...militiaPreset, armor: 'rusty-shortsword' }))).toEqual([
        err(presetPath, 'armor', '"rusty-shortsword" is not armor'),
      ]);
      expect(checkContent(changed(presetPath, { ...militiaPreset, weapon: 'nope', armor: 'nada' }))).toEqual([
        err(presetPath, 'armor', 'no item with id "nada"'),
        err(presetPath, 'weapon', 'no item with id "nope"'),
      ]);
    });

    it('accepts a preset with no weapon and no armor', () => {
      expect(checkContent(changed(presetPath, { ...militiaPreset, weapon: null, armor: null }))).toEqual([]);
    });
  });

  describe('arenas', () => {
    it('rejects rows of unequal length', () => {
      const bad = changed(arenaPath, { ...arena, rows: ['#####', '#...#', '#.#.', '#...#', '#####'] });
      expect(checkContent(bad)).toEqual([err(arenaPath, 'rows[2]', 'is 4 characters long, expected 5 like the first row')]);
    });

    it('rejects a character other than # or .', () => {
      const bad = changed(arenaPath, { ...arena, rows: ['#####', '#...#', '#.x.#', '#...#', '#####'] });
      expect(checkContent(bad)).toEqual([err(arenaPath, 'rows[2]', 'unknown tile "x" at column 2 (use # or .)')]);
    });

    it('rejects a campfire out of bounds or on a wall', () => {
      expect(checkContent(changed(arenaPath, { ...arena, campfire: { x: 9, y: 3 }, spawn: { x: 1, y: 3 } }))).toContainEqual(
        err(arenaPath, 'campfire', '(9, 3) is outside the arena'),
      );
      expect(checkContent(changed(arenaPath, { ...arena, campfire: { x: 2, y: 2 }, spawn: { x: 1, y: 3 } }))).toContainEqual(
        err(arenaPath, 'campfire', '(2, 2) is a wall'),
      );
    });

    it('rejects a spawn that is a wall or out of bounds', () => {
      expect(checkContent(changed(arenaPath, { ...arena, spawn: { x: 0, y: 3 } }))).toContainEqual(
        err(arenaPath, 'spawn', '(0, 3) is not a walkable tile'),
      );
      expect(checkContent(changed(arenaPath, { ...arena, spawn: { x: 1, y: 9 } }))).toContainEqual(
        err(arenaPath, 'spawn', '(1, 9) is not a walkable tile'),
      );
    });

    it('rejects a spawn that is not next to the campfire (Chebyshev 1), including on it', () => {
      expect(own(arenaPath, changed(arenaPath, { ...arena, spawn: { x: 1, y: 1 } }))).toEqual([
        err(arenaPath, 'spawn', '(1, 1) must be next to the campfire (2, 3)'),
      ]);
      expect(own(arenaPath, changed(arenaPath, { ...arena, spawn: { x: 2, y: 3 } }))).toEqual([
        err(arenaPath, 'spawn', '(2, 3) must be next to the campfire (2, 3)'),
      ]);
    });

    it('accepts a diagonal spawn', () => {
      expect(checkContent(changed(arenaPath, { ...arena, spawn: { x: 3, y: 3 } }))).toEqual([]);
      expect(checkContent(changed(arenaPath, { ...arena, campfire: { x: 1, y: 3 }, spawn: { x: 2, y: 3 } }))).toEqual([]);
    });

    it('rejects an unknown starting preset', () => {
      const bad = changed(arenaPath, { ...arena, startingPreset: 'nobody' });
      expect(checkContent(bad)).toEqual([err(arenaPath, 'startingPreset', 'no preset with id "nobody"')]);
    });
  });

  describe('waves', () => {
    it('rejects an unknown arena and an unknown enemy', () => {
      const bad = changed(wavePath, { ...wave, arena: 'nowhere', enemies: [{ enemy: 'ogre', x: 1, y: 1 }] });
      expect(checkContent(bad)).toEqual([
        err(wavePath, 'arena', 'no arena with id "nowhere"'),
        err(wavePath, 'enemies[0].enemy', 'no enemy with id "ogre"'),
      ]);
    });

    it('rejects a tile out of bounds, on a wall, on the campfire or on the spawn', () => {
      const bad = changed(wavePath, {
        ...wave,
        enemies: [
          { enemy: 'slime', x: 9, y: 1 },
          { enemy: 'slime', x: 2, y: 2 },
          { enemy: 'slime', x: 2, y: 3 },
          { enemy: 'slime', x: 1, y: 3 },
        ],
      });
      expect(checkContent(bad)).toEqual([
        err(wavePath, 'enemies[0]', '(9, 1) is outside the arena'),
        err(wavePath, 'enemies[1]', '(2, 2) is a wall'),
        err(wavePath, 'enemies[2]', '(2, 3) is the campfire'),
        err(wavePath, 'enemies[3]', '(1, 3) is the spawn tile'),
      ]);
    });

    it('rejects a repeated tile', () => {
      const bad = changed(wavePath, { ...wave, enemies: [{ enemy: 'slime', x: 1, y: 1 }, { enemy: 'slime', x: 1, y: 1 }] });
      expect(checkContent(bad)).toEqual([err(wavePath, 'enemies[1]', 'repeated tile (1, 1), also used by enemies[0]')]);
    });

    it('rejects a wave with no enemies', () => {
      expect(checkContent(changed(wavePath, { ...wave, enemies: [] }))).toEqual([
        err(wavePath, 'enemies', 'must have at least 1 item'),
      ]);
    });
  });
});

describe('formatProblem', () => {
  it('prints file, field and message', () => {
    const p = { file: 'content/items/x.json', field: 'damageSplit[1].kind', severity: 'error' as const, message: 'expected one of force' };
    expect(formatProblem(p)).toBe('content/items/x.json: damageSplit[1].kind: expected one of force');
  });

  it('prefixes a warning with "warning: " and leaves an error unprefixed', () => {
    const p = { file: 'content/enemies/slime.json', field: 'resistances[0].multiplier', severity: 'warning' as const, message: '4 is outside the usual range 0.25–3' };
    expect(formatProblem(p)).toBe('content/enemies/slime.json: resistances[0].multiplier: warning: 4 is outside the usual range 0.25–3');
  });

  it('prefixes a warning with no field too', () => {
    const p = { file: 'content/items/x.json', field: '', severity: 'warning' as const, message: 'odd' };
    expect(formatProblem(p)).toBe('content/items/x.json: warning: odd');
  });

  it('leaves out an empty field', () => {
    const p = { file: 'content/items/x.json', field: '', severity: 'error' as const, message: 'not a .json file' };
    expect(formatProblem(p)).toBe('content/items/x.json: not a .json file');
  });
});
