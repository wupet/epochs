import { dirname, resolve } from 'node:path';
import { buildContentBundle, formatProblem } from '@epochs/shared';
import type { ContentBundle } from '@epochs/shared';
import { readContentFiles } from '@epochs/tools/content-files';

/**
 * Reads and checks everything under `contentDir` (the repo's `content/` folder) and returns the bundle
 * the game rules use. Throws an `Error` whose message lists every problem, one per line, if any is an
 * error or there are no files. Warnings alone do not stop it.
 */
export function loadContent(contentDir: string): ContentBundle {
  // `readContentFiles` takes the repo root and reads `<root>/content`.
  const files = readContentFiles(dirname(resolve(contentDir)));
  if (files.length === 0) throw new Error(`No content files found in ${contentDir}.`);
  const { bundle, problems } = buildContentBundle(files);
  if (bundle === null) {
    throw new Error(`The content has problems:\n${problems.map(formatProblem).join('\n')}`);
  }
  return bundle;
}
