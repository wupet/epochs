/**
 * Test support only: reads the real `content/` folder with Node's file system. This folder is left out
 * of the pure `packages/shared` typecheck (tsconfig.json) and checked with Node types instead
 * (tsconfig.test.json). Game code must never import it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentBundle } from '../content/bundle';
import type { ContentFile } from '../content/check';
import { buildContentBundle } from '../content/load';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The real files under `content/`, as the checker sees them (paths relative to the repo, forward slashes). */
export function realContentFiles(): ContentFile[] {
  return readdirSync(`${repoRoot}content`, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => ({
      path: `content/${basename(e.parentPath)}/${e.name}`,
      text: readFileSync(join(e.parentPath, e.name), 'utf8'),
    }));
}

/** The real content bundle. Throws if the real content has an error. */
export function realContent(): ContentBundle {
  const { bundle } = buildContentBundle(realContentFiles());
  if (!bundle) throw new Error('The real content does not load.');
  return bundle;
}
