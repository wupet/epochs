import { describe, expect, it } from 'vitest';
import { FORBIDDEN_PATTERNS, findForbidden, stripComments } from './purity';

describe('findForbidden', () => {
  it.each([
    ['Math.random', 'const r = Math.random();'],
    ['Date.now', 'const t = Date.now();'],
    ['new Date', 'const d = new Date();'],
    ['new Date with extra spaces', 'const d = new  Date(0);'],
    ['Math . random with spaces', 'const r = Math . random();'],
  ])('flags %s', (_name, source) => {
    const hits = findForbidden(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(1);
  });

  it('ignores mentions inside comments', () => {
    expect(findForbidden('// Math.random is banned\n/* Date.now */ const x = 1;')).toEqual([]);
  });

  it('does not treat // inside a string as a comment', () => {
    expect(findForbidden("const u = 'http://x'; Math.random()")).toHaveLength(1);
  });

  it('does not treat /* inside a string as a comment', () => {
    expect(findForbidden('const a = "/*"; Date.now()')).toHaveLength(1);
  });

  it('does not treat // inside a template literal as a comment', () => {
    expect(findForbidden('const a = `//${1}`; new Date()')).toHaveLength(1);
  });

  it('reports the line number of the hit', () => {
    const source = 'const a = 1;\nconst b = 2;\nconst r = Math.random();\n';
    expect(findForbidden(source)).toEqual([{ line: 3, match: 'Math.random' }]);
  });

  it('does not flag lookalike names', () => {
    expect(findForbidden('const MathRandom = 1; myDate.nowish();')).toEqual([]);
  });

  it('flags Date called without new', () => {
    expect(findForbidden('const s = Date();')).toHaveLength(1);
    expect(findForbidden('const s = Date ();')).toHaveLength(1);
  });

  it('reports new Date() exactly once', () => {
    expect(findForbidden('const d = new Date();')).toHaveLength(1);
  });

  it('does not flag names or members that merely end in Date', () => {
    expect(findForbidden('const a = toDate(); const b = myDate(); const c = x.Date(1);')).toEqual([]);
  });
});

describe('stripComments', () => {
  it('blanks comment text but keeps newlines', () => {
    const source = 'a // x\n/* y\nz */ b';
    const stripped = stripComments(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.split('\n')).toHaveLength(3);
    expect(stripped).not.toMatch(/[xyz]/);
  });

  it('honours backslash escapes inside strings', () => {
    expect(findForbidden("const s = 'it\\'s // fine'; Math.random()")).toHaveLength(1);
  });
});

describe('FORBIDDEN_PATTERNS', () => {
  it('lists the four banned constructs', () => {
    expect(FORBIDDEN_PATTERNS).toHaveLength(4);
  });
});
