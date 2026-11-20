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

/** Runs the check for `repoRoot`, returning the lines to print and the process exit code. */
export function checkReport(repoRoot: string): { lines: string[]; exitCode: number } {
  const { problems, fileCount } = runCheck(repoRoot);
  // No content at all is an error: an empty or missing `content/` must never pass quietly.
  if (fileCount === 0) return { lines: [`No content files found in ${join(repoRoot, 'content')}.`], exitCode: 1 };
  if (problems.length === 0) return { lines: [`All ${fileCount} content files are valid.`], exitCode: 0 };
  const filesWithProblems = new Set(problems.map((p) => p.file)).size;
  return {
    lines: [
      ...problems.map(formatProblem),
      `Found ${plural(problems.length, 'problem')} in ${plural(filesWithProblems, 'file')}.`,
    ],
    exitCode: 1,
  };
}
