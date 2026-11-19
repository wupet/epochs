import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGION_SIZE_TILES } from '@epochs/shared';
import { CONTENT_DIR } from './paths';

describe('tools', () => {
  it('finds the content folder', () => {
    expect(existsSync(CONTENT_DIR)).toBe(true);
  });

  it('can import the shared rules', () => {
    expect(REGION_SIZE_TILES).toBe(64);
  });
});
