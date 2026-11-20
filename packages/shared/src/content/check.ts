/**
 * `checkContent`: validates a set of content files and reports every problem, naming the file, the
 * field and what is wrong. Pure: it takes file contents as input and never touches the file system.
 */
import { z } from 'zod';
import { CONTENT_KINDS, ID_PATTERN } from './schemas';
import type { AbilityContent, ClassContent, ContentKind, EnemyContent, ItemContent } from './schemas';

/** A content file as the checker sees it: `path` is relative to the repo, with forward slashes. */
export interface ContentFile {
  readonly path: string;
  readonly text: string;
}

/** One thing wrong. `field` is a readable path such as `damageSplit[1].kind`, or `""` for the whole file. */
export interface ContentProblem {
  readonly file: string;
  readonly field: string;
  readonly message: string;
}

/** The most kinds an item's damage split may have ("Weapons split their damage across one or two kinds"). */
export const MAX_ITEM_DAMAGE_KINDS = 2;

const KIND_NAMES = Object.keys(CONTENT_KINDS) as ContentKind[];

export function formatProblem(p: ContentProblem): string {
  return p.field === '' ? `${p.file}: ${p.message}` : `${p.file}: ${p.field}: ${p.message}`;
}

type Found = Omit<ContentProblem, 'file'>;

function isContentKind(name: string): name is ContentKind {
  return (KIND_NAMES as readonly string[]).includes(name);
}

// ---- Step 1: the path ----------------------------------------------------------------------------

type PathInfo = { ok: true; kind: ContentKind; name: string } | { ok: false; message: string };

function readPath(path: string): PathInfo {
  const shape = 'expected content/<kind>/<name>.json';
  const parts = path.split('/');
  if (parts[0] !== 'content' || parts.length < 3) return { ok: false, message: `path is wrong: ${shape}` };
  if (parts.length > 3) return { ok: false, message: `path is too deep: ${shape}` };
  const folder = parts[1] ?? '';
  const fileName = parts[2] ?? '';
  if (!isContentKind(folder)) {
    return { ok: false, message: `unknown content folder "${folder}" (expected ${KIND_NAMES.join(', ')})` };
  }
  if (!fileName.endsWith('.json') || fileName === '.json') return { ok: false, message: 'not a .json file' };
  return { ok: true, kind: folder, name: fileName.slice(0, -'.json'.length) };
}

// ---- Step 3: Zod issues to plain messages -------------------------------------------------------------

/** `a.b[1].c`: numbers in brackets, keys joined with dots. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

function describeBound(origin: string, bound: number, inclusive: boolean, direction: 'min' | 'max'): string {
  if (origin === 'string' || origin === 'array') {
    const unit = origin === 'string' ? 'characters' : 'items';
    if (direction === 'min' && bound === 1) return origin === 'string' ? 'must not be empty' : 'must have at least 1 item';
    return `must have ${direction === 'min' ? 'at least' : 'at most'} ${bound} ${unit}`;
  }
  if (direction === 'min') return inclusive ? `must be at least ${bound}` : `must be greater than ${bound}`;
  return inclusive ? `must be at most ${bound}` : `must be less than ${bound}`;
}

function describeIssue(issue: z.core.$ZodIssue): string {
  // A missing field is "required" whatever the schema expected (a type, an enum, a literal).
  if (issue.input === undefined) return 'required';
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'int') return 'must be a whole number';
      return `expected ${issue.expected}`;
    case 'invalid_value':
      return `expected one of ${issue.values.map(String).join(', ')}`;
    case 'invalid_format':
      if (issue.format === 'regex' && issue.pattern === String(ID_PATTERN)) {
        return 'must be lowercase letters, digits and hyphens, starting with a letter';
      }
      return 'is not in the expected format';
    case 'too_small':
      return describeBound(issue.origin, Number(issue.minimum), issue.inclusive ?? true, 'min');
    case 'too_big':
      return describeBound(issue.origin, Number(issue.maximum), issue.inclusive ?? true, 'max');
    default:
      return issue.message;
  }
}

function mapIssue(issue: z.core.$ZodIssue): Found[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({ field: formatPath([...issue.path, key]), message: 'unknown field' }));
  }
  return [{ field: formatPath(issue.path), message: describeIssue(issue) }];
}

// ---- Steps 4 and 5: the rules within one file --------------------------------------------------------

type Entry =
  | { readonly kind: 'classes'; readonly data: ClassContent }
  | { readonly kind: 'abilities'; readonly data: AbilityContent }
  | { readonly kind: 'items'; readonly data: ItemContent }
  | { readonly kind: 'enemies'; readonly data: EnemyContent };

/** A problem on every entry whose key was already seen earlier in the list. */
function repeats<T>(
  list: readonly T[],
  keyOf: (item: T) => string,
  field: (index: number) => string,
  describe: (key: string) => string,
): Found[] {
  const seen = new Set<string>();
  const found: Found[] = [];
  list.forEach((item, i) => {
    const key = keyOf(item);
    if (seen.has(key)) found.push({ field: field(i), message: describe(key) });
    seen.add(key);
  });
  return found;
}

function repeatedKinds(name: string, list: readonly { readonly kind: string }[]): Found[] {
  return repeats(list, (e) => e.kind, (i) => `${name}[${i}].kind`, (k) => `repeated damage kind "${k}"`);
}

function rulesWithinFile(entry: Entry): Found[] {
  switch (entry.kind) {
    case 'classes':
      return [
        ...repeats(
          entry.data.prerequisites,
          (p) => p.classId,
          (i) => `prerequisites[${i}].classId`,
          (k) => `repeated prerequisite class "${k}"`,
        ),
        ...repeats(
          entry.data.startingAbilities,
          (a) => a,
          (i) => `startingAbilities[${i}]`,
          (k) => `repeated starting ability "${k}"`,
        ),
      ];
    case 'abilities':
      return repeatedKinds('damage', entry.data.damage);
    case 'items': {
      const kinds = new Set(entry.data.damageSplit.map((d) => d.kind));
      return [
        ...repeatedKinds('damageSplit', entry.data.damageSplit),
        ...(kinds.size > MAX_ITEM_DAMAGE_KINDS
          ? [{ field: 'damageSplit', message: `at most ${MAX_ITEM_DAMAGE_KINDS} damage kinds allowed, found ${kinds.size}` }]
          : []),
        ...repeats(
          entry.data.requirements,
          (r) => r.attribute,
          (i) => `requirements[${i}].attribute`,
          (k) => `repeated attribute "${k}"`,
        ),
      ];
    }
    case 'enemies':
      return [
        ...repeatedKinds('damage', entry.data.damage),
        ...repeatedKinds('resistances', entry.data.resistances),
      ];
  }
}

// ---- Step 6: the rules across files ------------------------------------------------------------------

interface Loaded {
  readonly file: string;
  readonly entry: Entry;
}

function rulesAcrossFiles(loaded: readonly Loaded[]): ContentProblem[] {
  const found: ContentProblem[] = [];
  const add = (file: string, field: string, message: string) => found.push({ file, field, message });

  // The first file (by path) to use an id keeps it; each later one is reported.
  const firstById = new Map<string, string>();
  for (const { file, entry } of loaded) {
    const key = `${entry.kind}/${entry.data.id}`;
    const first = firstById.get(key);
    if (first === undefined) firstById.set(key, file);
    else add(file, 'id', `duplicate id, also used by ${first}`);
  }

  const idsOf = (kind: ContentKind) =>
    new Set(loaded.filter((l) => l.entry.kind === kind).map((l) => l.entry.data.id));
  const abilityIds = idsOf('abilities');
  const classIds = idsOf('classes');

  for (const { file, entry } of loaded) {
    if (entry.kind !== 'classes') continue;
    entry.data.startingAbilities.forEach((abilityId, i) => {
      if (!abilityIds.has(abilityId)) add(file, `startingAbilities[${i}]`, `no ability with id "${abilityId}"`);
    });
    entry.data.prerequisites.forEach((p, i) => {
      const field = `prerequisites[${i}].classId`;
      if (p.classId === entry.data.id) add(file, field, "a class can't require itself");
      else if (!classIds.has(p.classId)) add(file, field, `no class with id "${p.classId}"`);
    });
  }
  return found;
}

// ---- The checker ------------------------------------------------------------------------------------

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Checks every file and returns the problems, sorted by file, then field, then message. Files that
 * can't be read as their kind (bad path, bad JSON, wrong shape) are left out of the cross-file checks.
 */
export function checkContent(files: readonly ContentFile[]): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const loaded: Loaded[] = [];

  // Path order, so "the first file to use an id" doesn't depend on the order the caller listed them.
  const ordered = [...files].sort((a, b) => byText(a.path, b.path));

  for (const { path, text } of ordered) {
    const report = (found: readonly Found[]) => {
      for (const f of found) problems.push({ file: path, ...f });
    };

    const info = readPath(path);
    if (!info.ok) {
      report([{ field: '', message: info.message }]);
      continue;
    }

    let value: unknown;
    try {
      // A byte-order mark (some Windows editors add one) is not part of the JSON.
      value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    } catch (e) {
      report([{ field: '', message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }]);
      continue;
    }

    const result = CONTENT_KINDS[info.kind].safeParse(value, { reportInput: true });
    if (!result.success) {
      report(result.error.issues.flatMap(mapIssue));
      continue;
    }

    // The schema picked by `info.kind` produced `result.data`, so the pair is consistent.
    const entry = { kind: info.kind, data: result.data } as Entry;
    const found: Found[] = [];
    if (entry.data.id !== info.name) found.push({ field: 'id', message: `must match the file name "${info.name}"` });
    found.push(...rulesWithinFile(entry));
    report(found);
    loaded.push({ file: path, entry });
  }

  problems.push(...rulesAcrossFiles(loaded));

  return problems.sort(
    (a, b) => byText(a.file, b.file) || byText(a.field, b.field) || byText(a.message, b.message),
  );
}
