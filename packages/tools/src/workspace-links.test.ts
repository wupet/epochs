import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureWorkspaceLinks, InstallNeededError } from './workspace-links';

// Each test builds a tiny repository in a temp folder:
//   repo/packages/core/package.json  (name @t/core)
//   repo/node_modules/@t/core        (a link, set up per test)

let scratch: string;
let repo: string;
let coreDir: string;
let linkPath: string;

const linkType = process.platform === 'win32' ? 'junction' : 'dir';

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'epochs-links-')));
  repo = join(scratch, 'repo');
  coreDir = join(repo, 'packages', 'core');
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ name: '@t/core' }));
  mkdirSync(join(repo, 'node_modules', '@t'), { recursive: true });
  linkPath = join(repo, 'node_modules', '@t', 'core');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function linkedManifestName(): string {
  return (JSON.parse(readFileSync(join(linkPath, 'package.json'), 'utf8')) as { name: string }).name;
}

describe('ensureWorkspaceLinks', () => {
  it('leaves a correct link alone', () => {
    symlinkSync(coreDir, linkPath, linkType);
    expect(ensureWorkspaceLinks(repo)).toEqual([{ name: '@t/core', status: 'ok' }]);
    expect(linkedManifestName()).toBe('@t/core');
  });

  it('repairs a link left dangling by moving the repository', () => {
    const oldDir = join(scratch, 'old-location', 'packages', 'core');
    mkdirSync(oldDir, { recursive: true });
    symlinkSync(oldDir, linkPath, linkType);
    rmSync(join(scratch, 'old-location'), { recursive: true }); // the move

    const [result] = ensureWorkspaceLinks(repo);
    expect(result?.status).toBe('repaired');
    expect(realpathSync(linkPath)).toBe(realpathSync(coreDir));
    expect(linkedManifestName()).toBe('@t/core');
  });

  it('repairs a link into a live old copy without deleting that copy', () => {
    const oldDir = join(scratch, 'old-copy', 'packages', 'core');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'package.json'), JSON.stringify({ name: '@t/core' }));
    symlinkSync(oldDir, linkPath, linkType);

    const [result] = ensureWorkspaceLinks(repo);
    expect(result?.status).toBe('repaired');
    expect(realpathSync(linkPath)).toBe(realpathSync(coreDir));
    expect(existsSync(join(oldDir, 'package.json'))).toBe(true);
  });

  it('asks for npm ci when a package was never linked', () => {
    expect(() => ensureWorkspaceLinks(repo)).toThrow(InstallNeededError);
    expect(() => ensureWorkspaceLinks(repo)).toThrow(/npm ci/);
  });

  it('asks for npm ci when node_modules is missing', () => {
    rmSync(join(repo, 'node_modules'), { recursive: true });
    expect(() => ensureWorkspaceLinks(repo)).toThrow(/npm ci/);
  });
});
