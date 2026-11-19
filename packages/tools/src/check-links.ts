// Runs before `npm run dev`, `npm test` and `npm run typecheck` (see the root package.json).
// Silent when every workspace link is right; says so when it repairs one.
import { fileURLToPath } from 'node:url';
import { ensureWorkspaceLinks, InstallNeededError } from './workspace-links';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

try {
  for (const result of ensureWorkspaceLinks(repoRoot)) {
    if (result.status === 'repaired') {
      console.log(`Repaired workspace link ${result.name} (it pointed to ${result.previousTarget}).`);
    }
  }
} catch (error) {
  if (!(error instanceof InstallNeededError)) throw error;
  console.error(`Workspace links: ${error.message}`);
  process.exitCode = 1;
}
