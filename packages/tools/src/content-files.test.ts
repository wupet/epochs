import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readContentFiles } from './content-files';

let repo: string;

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'epochs-content-')));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function write(relative: string, text: string): void {
  const full = join(repo, relative);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, text);
}

describe('readContentFiles', () => {
  it('finds nested files with forward-slash paths relative to the repo, sorted', () => {
    write('content/items/sword.json', '{"a":1}');
    write('content/classes/militia.json', '{"b":2}');
    write('content/deep/er/still.json', '{}');
    expect(readContentFiles(repo)).toEqual([
      { path: 'content/classes/militia.json', text: '{"b":2}' },
      { path: 'content/deep/er/still.json', text: '{}' },
      { path: 'content/items/sword.json', text: '{"a":1}' },
    ]);
  });

  it('skips dotfiles and dot-directories', () => {
    write('content/.gitkeep', '');
    write('content/items/.hidden.json', '{}');
    write('content/.cache/x.json', '{}');
    write('content/items/sword.json', '{}');
    expect(readContentFiles(repo).map((f) => f.path)).toEqual(['content/items/sword.json']);
  });

  it('includes files that are not .json, so the checker can report them', () => {
    write('content/items/notes.txt', 'hi');
    expect(readContentFiles(repo).map((f) => f.path)).toEqual(['content/items/notes.txt']);
  });

  it('returns nothing when there is no content folder', () => {
    expect(readContentFiles(repo)).toEqual([]);
  });
});
