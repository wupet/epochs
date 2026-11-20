import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_DIR } from '@epochs/tools/paths';
import { loadContent } from './load-content';

describe('loadContent', () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('loads the real content of the repo', () => {
    const bundle = loadContent(CONTENT_DIR);

    expect(Object.keys(bundle.arenas)).toContain('arena');
    expect(Object.keys(bundle.waves)).toContain('practice');
  });

  it('throws an error naming the file and field of every problem when the content is broken', () => {
    const root = mkdtempSync(join(tmpdir(), 'epochs-content-'));
    temps.push(root);
    cpSync(CONTENT_DIR, join(root, 'content'), { recursive: true });
    const file = join(root, 'content', 'items', 'cudgel.json');
    const broken = { ...(JSON.parse(readFileSync(file, 'utf8')) as object), name: 42 };
    writeFileSync(file, JSON.stringify(broken));

    let thrown: unknown;
    try {
      loadContent(join(root, 'content'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('content/items/cudgel.json');
    expect(message).toContain('name');
  });

  it('throws when there is no content at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'epochs-content-'));
    temps.push(root);

    expect(() => loadContent(join(root, 'content'))).toThrow(/No content files/);
  });
});
