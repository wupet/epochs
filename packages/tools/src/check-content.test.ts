import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCheck } from './run-check';

const realRepo = fileURLToPath(new URL('../../../', import.meta.url));
const cliPath = fileURLToPath(new URL('./check-content.ts', import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'epochs-check-')));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A temp repo holding a copy of the real content plus one broken item. */
function brokenRepo(): string {
  const repo = join(scratch, 'repo');
  cpSync(join(realRepo, 'content'), join(repo, 'content'), { recursive: true });
  mkdirSync(join(repo, 'content', 'items'), { recursive: true });
  writeFileSync(join(repo, 'content', 'items', 'broken.json'), '{"id":"broken","name":"x","kind":"sword"}');
  return repo;
}

function runCli(env: Record<string, string> = {}, script: string = cliPath) {
  const cwd = join(scratch, 'elsewhere');
  mkdirSync(cwd, { recursive: true });
  return spawnSync(process.execPath, ['--import', tsxLoader, script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
}

describe('runCheck', () => {
  it('finds the real content valid, all four sample files', () => {
    const result = runCheck(realRepo);
    expect(result.problems).toEqual([]);
    expect(result.fileCount).toBe(4);
  });

  it('names the broken file and field', () => {
    const { problems } = runCheck(brokenRepo());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.file === 'content/items/broken.json')).toBe(true);
    expect(problems.some((p) => p.field === 'kind')).toBe(true);
  });
});

describe('the check-content command', () => {
  it('exits 0 and says all four files are valid, from any working directory', () => {
    const result = runCli();
    expect(result.stdout).toContain('All 4 content files are valid.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and reports problems for a broken file', () => {
    const result = runCli({ EPOCHS_REPO_ROOT: brokenRepo() });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('content/items/broken.json: kind:');
    expect(result.stdout).toMatch(/Found \d+ problems? in 1 file\./);
  });

  it('exits 1 and says so when there is no content at all', () => {
    const emptyRoot = join(scratch, 'empty');
    mkdirSync(emptyRoot, { recursive: true });
    const result = runCli({ EPOCHS_REPO_ROOT: emptyRoot });
    expect(result.stdout).toContain(`No content files found in ${join(emptyRoot, 'content')}.`);
    expect(result.status).toBe(1);
  });

  it('exits 1 for a content folder that exists but is empty', () => {
    const emptyRoot = join(scratch, 'empty');
    mkdirSync(join(emptyRoot, 'content'), { recursive: true });
    const result = runCli({ EPOCHS_REPO_ROOT: emptyRoot });
    expect(result.stdout).toContain('No content files found in');
    expect(result.status).toBe(1);
  });

  it('still runs when started through a junction or symlink (never a silent no-op)', (ctx) => {
    const link = join(scratch, 'linked-src');
    try {
      symlinkSync(join(realRepo, 'packages', 'tools', 'src'), link, 'junction');
    } catch (error) {
      ctx.skip(`could not create a junction or symlink here: ${String(error)}`);
      return;
    }
    try {
      const result = runCli({}, join(link, 'check-content.ts'));
      expect(result.stdout).toContain('All 4 content files are valid.');
      expect(result.status).toBe(0);
    } finally {
      // Removes only the link itself, never what it points to.
      unlinkSync(link);
    }
  });
}, 20_000);
