// `npm run check-content`: validates everything in `content/` and reports each problem as
// file, field and message. Exits 1 if any error is found, or if there is no content at all; warnings
// are printed but do not fail the check.
// This is an entry script and always runs: no "am I the main module?" guard, because that guard
// silently skips the run when started through a symlink or junction. The testable code lives in
// `run-check.ts`.
import { repoRootFromEnv } from './paths';
import { checkReport } from './run-check';

const { lines, exitCode } = checkReport(repoRootFromEnv());
for (const line of lines) console.log(line);
process.exitCode = exitCode;
