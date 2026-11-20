import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentFile } from '@epochs/shared';

/**
 * Reads every file under `<repoRoot>/content`, however deep, as the checker's input. Dotfiles and
 * dot-directories (such as `.gitkeep`) are skipped; every other file is included, even a non-`.json`
 * one, so the checker can report it. Paths are relative to the repo, with forward slashes, sorted.
 */
export function readContentFiles(repoRoot: string): ContentFile[] {
  const files: ContentFile[] = [];

  function walk(dir: string, relative: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = join(dir, entry.name);
      const entryRelative = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(entryPath, entryRelative);
      else if (entry.isFile()) files.push({ path: entryRelative, text: readFileSync(entryPath, 'utf8') });
    }
  }

  walk(join(repoRoot, 'content'), 'content');
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
