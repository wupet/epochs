// The content check itself, separate from the command so tests can import it without running it.
import { join } from 'node:path';
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

/** Runs the check for `repoRoot`, returning the lines to print and the exit code (1 only if there is an error; warnings alone pass). */
export function checkReport(repoRoot: string): { lines: string[]; exitCode: number } {
  const { problems, fileCount } = runCheck(repoRoot);
  // No content at all is an error: an empty or missing `content/` must never pass quietly.
  if (fileCount === 0) return { lines: [`No content files found in ${join(repoRoot, 'content')}.`], exitCode: 1 };
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  if (errors === 0) {
    const suffix = warnings === 0 ? '.' : `, with ${plural(warnings, 'warning')}.`;
    return { lines: [...problems.map(formatProblem), `All ${fileCount} content files are valid${suffix}`], exitCode: 0 };
  }
  const filesWithProblems = new Set(problems.map((p) => p.file)).size;
  const counts = warnings === 0 ? plural(errors, 'error') : `${plural(errors, 'error')} and ${plural(warnings, 'warning')}`;
  return {
    lines: [...problems.map(formatProblem), `Found ${counts} in ${plural(filesWithProblems, 'file')}.`],
    exitCode: 1,
  };
}
