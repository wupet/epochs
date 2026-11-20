import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkReport, runCheck } from './run-check';

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

/** Real content plus enemies whose resistance multipliers are the given values (all unusual ones warn). */
function warningRepo(...multipliers: number[]): string {
  const repo = join(scratch, 'repo');
  cpSync(join(realRepo, 'content'), join(repo, 'content'), { recursive: true });
  multipliers.forEach((multiplier, i) => {
    const id = `odd-${i}`;
    const enemy = {
      id,
      name: 'Odd',
      family: 'odd',
      tier: 1,
      health: 5,
      speed: 500,
      attacks: [],
      resistances: [{ kind: 'precision', multiplier }],
      intelligence: 'mindless',
    };
    writeFileSync(join(repo, 'content', 'enemies', `${id}.json`), JSON.stringify(enemy));
  });
  return repo;
}

/** Real content, one item with a single error (the kind), and one enemy with an unusual multiplier. */
function errorAndWarningRepo(withWarning = true): string {
  const repo = withWarning ? warningRepo(4) : warningRepo();
  mkdirSync(join(repo, 'content', 'items'), { recursive: true });
  const item = { id: 'broken', name: 'x', kind: 'sword', quality: 'crude', damageSplit: [], requirements: [] };
  writeFileSync(join(repo, 'content', 'items', 'broken.json'), JSON.stringify(item));
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

describe('checkReport wording', () => {
  it('says "1 error and 1 warning in 2 files" with the right singulars', () => {
    const { lines, exitCode } = checkReport(errorAndWarningRepo());
    expect(lines.at(-1)).toBe('Found 1 error and 1 warning in 2 files.');
    expect(exitCode).toBe(1);
  });

  it('leaves out the warnings when there are none', () => {
    const { lines } = checkReport(errorAndWarningRepo(false));
    expect(lines.at(-1)).toBe('Found 1 error in 1 file.');
  });
});

describe('runCheck', () => {
  it('finds the real content valid, all 15 files', () => {
    const result = runCheck(realRepo);
    expect(result.problems).toEqual([]);
    expect(result.fileCount).toBe(15);
  });

  it('names the broken file and field', () => {
    const { problems } = runCheck(brokenRepo());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.file === 'content/items/broken.json')).toBe(true);
    expect(problems.some((p) => p.field === 'kind')).toBe(true);
  });
});

describe('the check-content command', () => {
  it('exits 0 and says all 15 files are valid, from any working directory', () => {
    const result = runCli();
    expect(result.stdout).toContain('All 15 content files are valid.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and reports problems for a broken file', () => {
    const result = runCli({ EPOCHS_REPO_ROOT: brokenRepo() });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('content/items/broken.json: kind:');
    expect(result.stdout).toMatch(/Found \d+ errors? in 1 file\.$/m);
    expect(result.stdout).not.toContain('warning');
  });

  it('exits 0 and counts the warnings when there are only warnings', () => {
    const result = runCli({ EPOCHS_REPO_ROOT: warningRepo(4) });
    expect(result.stdout).toContain(
      'content/enemies/odd-0.json: resistances[0].multiplier: warning: 4 is outside the usual range 0.25–3',
    );
    expect(result.stdout).toContain('All 16 content files are valid, with 1 warning.');
    expect(result.status).toBe(0);
  });

  it('uses the plural for several warnings', () => {
    const result = runCli({ EPOCHS_REPO_ROOT: warningRepo(4, 0.1) });
    expect(result.stdout).toContain('All 17 content files are valid, with 2 warnings.');
    expect(result.status).toBe(0);
  });

  it('prints errors and warnings together and exits 1', () => {
    const result = runCli({ EPOCHS_REPO_ROOT: errorAndWarningRepo() });
    expect(result.stdout).toContain('content/items/broken.json: kind:');
    expect(result.stdout).toContain('content/enemies/odd-0.json: resistances[0].multiplier: warning: ');
    expect(result.stdout).toMatch(/Found \d+ errors? and 1 warning in 2 files\.$/m);
    expect(result.status).toBe(1);
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
      expect(result.stdout).toContain('All 15 content files are valid.');
      expect(result.status).toBe(0);
    } finally {
      // Removes only the link itself, never what it points to.
      unlinkSync(link);
    }
  });
}, 20_000);
