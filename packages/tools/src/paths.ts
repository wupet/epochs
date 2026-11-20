import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root (with a trailing separator), from this file's location. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Absolute path to the repository's `content/` folder. */
export const CONTENT_DIR = fileURLToPath(new URL('../../../content/', import.meta.url));

/** The repo root to check: `EPOCHS_REPO_ROOT` if set (for tests that check a copy), else this repo. */
export function repoRootFromEnv(env: Record<string, string | undefined> = process.env): string {
  return env.EPOCHS_REPO_ROOT ?? REPO_ROOT;
}
