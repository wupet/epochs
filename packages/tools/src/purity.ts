import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Constructs that must never appear in `packages/shared` (rule 2: shared rules are
 * pure and deterministic). Randomness comes from a seeded generator; time comes in
 * as a tick number.
 */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\bMath\s*\.\s*random\b/,
  /\bDate\s*\.\s*now\b/,
  /\bnew\s+Date\b/,
  // `Date()` without `new` returns the current time as a string. `new Date(` is the pattern above.
  /(?<![.\w])(?<!\bnew\s+)Date\s*\(/,
];

export interface ForbiddenHit {
  line: number;
  match: string;
}

export interface ForbiddenFileHit extends ForbiddenHit {
  file: string;
}

const SOURCE_FILE = /\.(?:ts|mts|js|mjs)$/;

/**
 * Replaces comment text with spaces, keeping newlines so line numbers survive.
 * A single left-to-right scan that knows about code, '...', "...", `...`, line
 * comments and block comments, and honours backslash escapes inside strings.
 *
 * Known limits: regex literals and `${}` nesting inside template literals are not
 * handled. A `//` inside a regex literal could hide the rest of its line.
 */
export function stripComments(source: string): string {
  type State = 'code' | "'" | '"' | '`' | 'line' | 'block';
  let state: State = 'code';
  let out = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);

    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') {
          state = 'line';
          out += '  ';
          i++;
        } else if (ch === '/' && next === '*') {
          state = 'block';
          out += '  ';
          i++;
        } else {
          if (ch === "'" || ch === '"' || ch === '`') state = ch;
          out += ch;
        }
        break;
      case 'line':
        if (ch === '\n') {
          state = 'code';
          out += ch;
        } else {
          out += ' ';
        }
        break;
      case 'block':
        if (ch === '*' && next === '/') {
          state = 'code';
          out += '  ';
          i++;
        } else {
          out += ch === '\n' || ch === '\r' ? ch : ' ';
        }
        break;
      default:
        // Inside a string or template literal.
        if (ch === '\\') {
          out += ch + next;
          i++;
        } else {
          if (ch === state) state = 'code';
          out += ch;
        }
    }
  }
  return out;
}

/** Finds forbidden constructs outside comments, in source order. */
export function findForbidden(source: string): ForbiddenHit[] {
  const code = stripComments(source);
  const found: { index: number; hit: ForbiddenHit }[] = [];

  for (const pattern of FORBIDDEN_PATTERNS) {
    const global = new RegExp(pattern.source, 'g');
    for (const m of code.matchAll(global)) {
      const index = m.index ?? 0;
      const line = code.slice(0, index).split('\n').length;
      found.push({ index, hit: { line, match: m[0] } });
    }
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.hit);
}

/** Scans every .ts, .mts, .js and .mjs file under `dir` (skipping node_modules). */
export function scanForForbidden(dir: string): ForbiddenFileHit[] {
  const hits: ForbiddenFileHit[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...scanForForbidden(path));
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      for (const hit of findForbidden(readFileSync(path, 'utf8'))) {
        hits.push({ file: path, ...hit });
      }
    }
  }
  return hits;
}
