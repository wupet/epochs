import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanForForbidden } from './purity';

const SHARED_DIR = fileURLToPath(new URL('../../shared/', import.meta.url));

describe('packages/shared purity', () => {
  it('contains no Math.random, Date.now or new Date', () => {
    const hits = scanForForbidden(SHARED_DIR);
    const report = hits.map((h) => `${h.file}:${h.line} ${h.match}`).join('\n');
    expect(report).toBe('');
  });

  it('the scan finds a banned call in a folder that has one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'epochs-purity-'));
    try {
      const file = join(dir, 'bad.ts');
      writeFileSync(file, 'export const r = Math.random();\n');
      expect(scanForForbidden(dir)).toEqual([{ file, line: 1, match: 'Math.random' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
