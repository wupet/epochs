import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGION_SIZE_TILES } from '@epochs/shared';
import { CONTENT_DIR, REPO_ROOT, repoRootFromEnv } from './paths';

describe('tools', () => {
  it('finds the content folder', () => {
    expect(existsSync(CONTENT_DIR)).toBe(true);
  });

  it('can import the shared rules', () => {
    expect(REGION_SIZE_TILES).toBe(64);
  });
});

describe('repoRootFromEnv', () => {
  it('uses EPOCHS_REPO_ROOT when set, else the repo root', () => {
    expect(repoRootFromEnv({ EPOCHS_REPO_ROOT: '/somewhere' })).toBe('/somewhere');
    expect(repoRootFromEnv({})).toBe(REPO_ROOT);
    expect(existsSync(REPO_ROOT)).toBe(true);
  });
});
