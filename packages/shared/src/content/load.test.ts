// The Zod-free check reads source files with Node's file system (tests are type-checked with Node types).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONTENT, lookup } from './bundle';
import type { ContentFile } from './check';
import { buildContentBundle } from './load';
import { realContentFiles as realFiles } from '../test-support/real-content';

const withText = (files: ContentFile[], path: string, text: string): ContentFile[] =>
  files.map((f) => (f.path === path ? { path, text } : f));

describe('buildContentBundle', () => {
  it('builds a bundle from the real content, keyed by id', () => {
    const { bundle, problems } = buildContentBundle(realFiles());
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.presets.militia?.weapon).toBe('rusty-shortsword');
    expect(Object.keys(bundle!.items).sort()).toEqual([
      'cudgel',
      'hunting-bow',
      'leather-jerkin',
      'rusty-shortsword',
      'witchs-staff',
    ]);
    expect(Object.keys(bundle!.enemies).sort()).toEqual(['slime', 'training-dummy']);
    expect(Object.keys(bundle!.waves).sort()).toEqual(['practice', 'wave-1']);
    expect(Object.keys(bundle!.classes)).toEqual(['militia']);
    expect(bundle!.arenas.arena?.startingPreset).toBe('militia');
  });

  it('gives no bundle when any file has an error, and still reports the problem', () => {
    const files = withText(realFiles(), 'content/enemies/slime.json', '{"id":"slime"}');
    const { bundle, problems } = buildContentBundle(files);
    expect(bundle).toBeNull();
    expect(problems.some((p) => p.severity === 'error' && p.file === 'content/enemies/slime.json')).toBe(true);
  });

  it('gives no bundle for an error found across files', () => {
    const files = realFiles().filter((f) => f.path !== 'content/items/leather-jerkin.json');
    const { bundle, problems } = buildContentBundle(files);
    expect(bundle).toBeNull();
    expect(problems.map((p) => p.message)).toContain('no item with id "leather-jerkin"');
  });

  it('still builds a bundle when there are only warnings, and returns them', () => {
    const slime = JSON.parse(realFiles().find((f) => f.path === 'content/enemies/slime.json')!.text) as Record<string, unknown>;
    const odd = { ...slime, resistances: [{ kind: 'force', multiplier: 0 }] };
    const { bundle, problems } = buildContentBundle(withText(realFiles(), 'content/enemies/slime.json', JSON.stringify(odd)));
    expect(bundle).not.toBeNull();
    expect(problems.map((p) => p.severity)).toEqual(['warning']);
    expect(bundle!.enemies.slime?.resistances).toEqual([{ kind: 'force', multiplier: 0 }]);
  });

  it('builds an empty bundle from no files', () => {
    expect(buildContentBundle([])).toEqual({ bundle: EMPTY_CONTENT, problems: [] });
  });
});

describe('lookup', () => {
  it('finds an id and returns undefined for an unknown one', () => {
    const { bundle } = buildContentBundle(realFiles());
    expect(lookup(bundle!.waves, 'wave-1')?.id).toBe('wave-1');
    expect(lookup(bundle!.waves, 'wave-9')).toBeUndefined();
  });

  it('does not find names inherited from Object.prototype ("constructor" passes ID_PATTERN)', () => {
    const { bundle } = buildContentBundle(realFiles());
    for (const name of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(lookup(bundle!.waves, name)).toBeUndefined();
      expect(lookup(bundle!.items, name)).toBeUndefined();
    }
  });

  it('has an empty content for every kind', () => {
    expect(EMPTY_CONTENT).toEqual({ classes: {}, items: {}, enemies: {}, presets: {}, arenas: {}, waves: {} });
  });
});

describe('Zod-free modules', () => {
  it.each(['vocabulary.ts', 'bundle.ts'])('%s imports nothing from zod at runtime', (name) => {
    const source = readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
    const runtimeImports = source.split('\n').filter((line) => /^import\s/.test(line) && !/^import type\s/.test(line));
    expect(runtimeImports.filter((line) => line.includes('zod') || line.includes('./schemas'))).toEqual([]);
  });
});
