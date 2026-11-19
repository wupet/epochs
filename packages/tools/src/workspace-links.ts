import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// npm links each workspace package into node_modules. On Windows those links are
// directory junctions, which can only hold absolute paths, so moving or copying the
// repository leaves them pointing at the old location. This checks every link and
// re-points any stale one at this repository's copy of the package.
//
// Node built-ins only: this runs before `dev`, `test` and `typecheck`, when the
// links may be broken, so it must not import any `@epochs/*` package.

export interface WorkspacePackage {
  /** Package name, e.g. `@epochs/shared`. */
  name: string;
  /** Absolute path to the package folder in this repository. */
  dir: string;
}

export interface LinkResult {
  name: string;
  status: 'ok' | 'repaired';
  /** Where a repaired link pointed before. */
  previousTarget?: string;
}

/** Thrown when the install itself is missing or damaged; the fix is `npm ci`. */
export class InstallNeededError extends Error {}

/** The workspace packages, one per folder in `packages/` (matching `"workspaces": ["packages/*"]`). */
export function listWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  const packagesDir = join(repoRoot, 'packages');
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'package.json')))
    .map((entry) => {
      const dir = join(packagesDir, entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown };
      if (typeof manifest.name !== 'string') throw new Error(`${join(dir, 'package.json')} has no name.`);
      return { name: manifest.name, dir };
    });
}

/** Checks every workspace link under `node_modules`, repairing any that point somewhere else. */
export function ensureWorkspaceLinks(repoRoot: string): LinkResult[] {
  const root = resolve(repoRoot);
  if (!existsSync(join(root, 'node_modules'))) {
    throw new InstallNeededError('node_modules is missing. Run `npm ci`.');
  }
  return listWorkspacePackages(root).map((pkg) => ensureLink(root, pkg));
}

function ensureLink(root: string, pkg: WorkspacePackage): LinkResult {
  const linkPath = join(root, 'node_modules', ...pkg.name.split('/'));

  let isLink: boolean;
  try {
    isLink = lstatSync(linkPath).isSymbolicLink(); // junctions count as symbolic links here
  } catch {
    throw new InstallNeededError(`${pkg.name} is not installed in node_modules. Run \`npm ci\`.`);
  }
  if (!isLink) {
    throw new InstallNeededError(`node_modules/${pkg.name} is a folder, not a workspace link. Run \`npm ci\`.`);
  }

  const previousTarget = resolve(dirname(linkPath), readlinkSync(linkPath));
  if (samePath(previousTarget, pkg.dir)) return { name: pkg.name, status: 'ok' };

  removeLink(linkPath);
  if (process.platform === 'win32') {
    symlinkSync(pkg.dir, linkPath, 'junction');
  } else {
    // Relative, as npm makes them, so the repository can move again.
    symlinkSync(relative(dirname(linkPath), pkg.dir), linkPath, 'dir');
  }
  return { name: pkg.name, status: 'repaired', previousTarget };
}

/**
 * Removes the link itself, never what it points to. A stale link may point at a
 * live old copy of the repository, so nothing here may delete recursively.
 */
function removeLink(linkPath: string): void {
  try {
    unlinkSync(linkPath);
  } catch {
    rmdirSync(linkPath); // some Windows setups only allow junctions to be removed as directories
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}
