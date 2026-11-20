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
};
const slime = {
  id: 'slime',
  name: 'Slime',
  family: 'slime',
  tier: 1,
  health: 10,
  damage: [{ kind: 'force', amount: 1 }],
  resistances: [{ kind: 'precision', multiplier: 0.5 }],
  intelligence: 'mindless',
};

const file = (path: string, value: unknown): ContentFile => ({ path, text: JSON.stringify(value) });
const samples = (): ContentFile[] => [
  file('content/classes/militia.json', militia),
  file('content/abilities/basic-strike.json', basicStrike),
  file('content/items/rusty-shortsword.json', rustyShortsword),
  file('content/enemies/slime.json', slime),
];
const strikeFile = file('content/abilities/basic-strike.json', basicStrike);

describe('checkContent', () => {
  it('accepts a fully valid set of four files', () => {
    expect(checkContent(samples())).toEqual([]);
  });

  it('accepts an empty set', () => {
    expect(checkContent([])).toEqual([]);
  });

  it('says "required" for a missing enum field, not "expected one of"', () => {
    const { kind: _kind, ...withoutKind } = rustyShortsword;
    const problems = checkContent([file('content/items/rusty-shortsword.json', withoutKind)]);
    expect(problems).toEqual([{ file: 'content/items/rusty-shortsword.json', field: 'kind', message: 'required' }]);
  });

  it('reports only the broken file when one is broken and one is valid (review focus 4)', () => {
    const broken = file('content/items/bad.json', { ...rustyShortsword, id: 'bad', kind: 'shiny' });
    expect(checkContent([strikeFile, broken])).toEqual([
      {
        file: 'content/items/bad.json',
        field: 'kind',
        message: 'expected one of plain, trait, storied, holy-relic, cursed, consumable, tool',
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
        message: 'expected one of force, precision, arcane, holy',
      },
    ]);
  });

  it('rejects a missing field', () => {
    const { capstone: _capstone, ...withoutCapstone } = militia;
    expect(checkContent([file('content/classes/militia.json', withoutCapstone), strikeFile])).toEqual([
      { file: 'content/classes/militia.json', field: 'capstone', message: 'required' },
    ]);
  });

  it('rejects an extra field', () => {
    const bad = file('content/abilities/basic-strike.json', { ...basicStrike, rangeTile: 2 });
    expect(checkContent([bad])).toEqual([
      { file: 'content/abilities/basic-strike.json', field: 'rangeTile', message: 'unknown field' },
    ]);
  });

  it('reports each extra field on its own, with the path to the key', () => {
    const bad = file('content/enemies/slime.json', {
      ...slime,
      damage: [{ kind: 'force', amount: 1, colour: 'red', size: 2 }],
    });
    expect(checkContent([bad])).toEqual([
      { file: 'content/enemies/slime.json', field: 'damage[0].colour', message: 'unknown field' },
      { file: 'content/enemies/slime.json', field: 'damage[0].size', message: 'unknown field' },
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
      { file: 'content/enemies/slime.json', field: 'name', message: 'expected string' },
    ]);
  });

  it('rejects a JSON file that is not an object', () => {
    expect(checkContent([{ path: 'content/enemies/slime.json', text: '[]' }])).toEqual([
      { file: 'content/enemies/slime.json', field: '', message: 'expected object' },
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
      { file: 'content/abilities/basic-strike.json', field: 'channelTicks', message: 'must be at least 0' },
      { file: 'content/abilities/basic-strike.json', field: 'damage[0].amount', message: 'must be at least 1' },
      { file: 'content/abilities/basic-strike.json', field: 'rangeTiles', message: 'must be a whole number' },
    ]);
  });

  it('says a multiplier must be above 0', () => {
    const bad = file('content/enemies/slime.json', { ...slime, resistances: [{ kind: 'force', multiplier: 0 }] });
    expect(checkContent([bad])).toEqual([
      { file: 'content/enemies/slime.json', field: 'resistances[0].multiplier', message: 'must be greater than 0' },
    ]);
  });

  it('rejects a bad id spelling', () => {
    const bad = file('content/classes/Militia.json', { ...militia, id: 'Militia' });
    expect(checkContent([bad])).toEqual([
      { file: 'content/classes/Militia.json', field: 'id', message: expect.stringContaining('lowercase') },
    ]);
  });

  it('rejects an id that does not match the file name', () => {
    const bad = file('content/items/rusty-shortsword.json', { ...rustyShortsword, id: 'shiny-sword' });
    expect(checkContent([bad])).toEqual([
      { file: 'content/items/rusty-shortsword.json', field: 'id', message: 'must match the file name "rusty-shortsword"' },
    ]);
  });

  it('rejects a duplicate id, on each file after the first', () => {
    const problems = checkContent([
      file('content/items/b.json', { ...rustyShortsword, id: 'a' }),
      file('content/items/a.json', { ...rustyShortsword, id: 'a' }),
      file('content/items/c.json', { ...rustyShortsword, id: 'a' }),
    ]);
    expect(problems).toEqual([
      { file: 'content/items/b.json', field: 'id', message: 'duplicate id, also used by content/items/a.json' },
      { file: 'content/items/b.json', field: 'id', message: 'must match the file name "b"' },
      { file: 'content/items/c.json', field: 'id', message: 'duplicate id, also used by content/items/a.json' },
      { file: 'content/items/c.json', field: 'id', message: 'must match the file name "c"' },
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
      { file: 'content/classes/militia.json', field: 'startingAbilities[1]', message: 'no ability with id "fireball"' },
    ]);
  });

  it('rejects a prerequisite class that does not exist', () => {
    const knight = file('content/classes/knight.json', {
      ...militia,
      id: 'knight',
      prerequisites: [{ classId: 'ghost', rank: 2 }],
    });
    expect(checkContent([...samples(), knight])).toEqual([
      { file: 'content/classes/knight.json', field: 'prerequisites[0].classId', message: 'no class with id "ghost"' },
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
      { file: 'content/classes/knight.json', field: 'prerequisites[0].classId', message: "a class can't require itself" },
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
      { file: 'content/abilities/basic-strike.json', field: 'damage[2].kind', message: 'repeated damage kind "force"' },
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
      { file: 'content/enemies/slime.json', field: 'resistances[1].kind', message: 'repeated damage kind "precision"' },
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
      { file: 'content/items/rusty-shortsword.json', field: 'requirements[1].attribute', message: 'repeated attribute "might"' },
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
      { file: 'content/classes/knight.json', field: 'prerequisites[1].classId', message: 'repeated prerequisite class "militia"' },
      { file: 'content/classes/knight.json', field: 'startingAbilities[1]', message: 'repeated starting ability "basic-strike"' },
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
        message: 'at most 2 damage kinds allowed, found 3',
      },
    ]);
  });

  it('rejects an unknown folder', () => {
    expect(checkContent([file('content/spells/fireball.json', basicStrike)])).toEqual([
      {
        file: 'content/spells/fireball.json',
        field: '',
        message: 'unknown content folder "spells" (expected classes, abilities, items, enemies)',
      },
    ]);
  });

  it('rejects a file that is not .json', () => {
    expect(checkContent([{ path: 'content/items/notes.txt', text: 'hello' }])).toEqual([
      { file: 'content/items/notes.txt', field: '', message: 'not a .json file' },
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

describe('formatProblem', () => {
  it('prints file, field and message', () => {
    const p = { file: 'content/items/x.json', field: 'damageSplit[1].kind', message: 'expected one of force' };
    expect(formatProblem(p)).toBe('content/items/x.json: damageSplit[1].kind: expected one of force');
  });

  it('leaves out an empty field', () => {
    const p = { file: 'content/items/x.json', field: '', message: 'not a .json file' };
    expect(formatProblem(p)).toBe('content/items/x.json: not a .json file');
  });
});
