// `npm run check-content`: validates everything in `content/` and reports each problem as
// file, field and message. Exits 1 if anything is wrong.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkContent, formatProblem } from '@epochs/shared';
import type { ContentProblem } from '@epochs/shared';
import { readContentFiles } from './content-files';

/** Reads `content/` under `repoRoot` and checks it. */
export function runCheck(repoRoot: string): { problems: ContentProblem[]; fileCount: number } {
  const files = readContentFiles(repoRoot);
  return { problems: checkContent(files), fileCount: files.length };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function main(): void {
  // The repo root comes from this file's location, so it works from any working directory.
  // EPOCHS_REPO_ROOT overrides it (for the test that checks a broken copy).
  const repoRoot = process.env.EPOCHS_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
  const { problems, fileCount } = runCheck(repoRoot);
  if (problems.length === 0) {
    console.log(`All ${fileCount} content files are valid.`);
    return;
  }
  for (const problem of problems) console.log(formatProblem(problem));
  const filesWithProblems = new Set(problems.map((p) => p.file)).size;
  console.log(`Found ${plural(problems.length, 'problem')} in ${plural(filesWithProblems, 'file')}.`);
  process.exitCode = 1;
}

// Run only when started as a script, not when a test imports `runCheck`.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) main();
