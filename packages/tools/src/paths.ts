import { fileURLToPath } from 'node:url';

/** Absolute path to the repository's `content/` folder. */
export const CONTENT_DIR = fileURLToPath(new URL('../../../content/', import.meta.url));
