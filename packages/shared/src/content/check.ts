/**
 * `checkContent`: validates a set of content files and reports every problem, naming the file, the
 * field and what is wrong. Pure: it takes file contents as input and never touches the file system.
 */
import { z } from 'zod';
import { BIRTH_POINTS, CONTENT_KINDS, ID_PATTERN, TIER_CAPACITY_COST } from './schemas';
import type {
  AbilityContent,
  ArenaContent,
  ClassContent,
  ContentKind,
  EnemyContent,
  ItemContent,
  PresetContent,
  WaveContent,
} from './schemas';

/** A content file as the checker sees it: `path` is relative to the repo, with forward slashes. */
export interface ContentFile {
  readonly path: string;
  readonly text: string;
}

/** One thing wrong. A warning is worth a look but does not fail the check. `field` is a readable path such as `damageSplit[1].kind`, or `""` for the whole file. */
export interface ContentProblem {
  readonly file: string;
  readonly field: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/** The most kinds an item's damage split may have ("Weapons split their damage across one or two kinds"). */
export const MAX_ITEM_DAMAGE_KINDS = 2;

/** Resistance multipliers outside this range (inclusive) get a warning. */
export const USUAL_MULTIPLIER_RANGE = { min: 0.25, max: 3 } as const;

/** The tile characters of an arena's `rows`. */
const WALL = '#';
const FLOOR = '.';

const KIND_NAMES = Object.keys(CONTENT_KINDS) as ContentKind[];

export function formatProblem(p: ContentProblem): string {
  const message = p.severity === 'warning' ? `warning: ${p.message}` : p.message;
  return p.field === '' ? `${p.file}: ${message}` : `${p.file}: ${p.field}: ${message}`;
}

/** A problem found inside one file; `severity` defaults to `'error'`. */
type Found = Omit<ContentProblem, 'file' | 'severity'> & { readonly severity?: ContentProblem['severity'] };

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
  | { readonly kind: 'enemies'; readonly data: EnemyContent }
  | { readonly kind: 'presets'; readonly data: PresetContent }
  | { readonly kind: 'arenas'; readonly data: ArenaContent }
  | { readonly kind: 'waves'; readonly data: WaveContent };

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

/** A warning on every multiplier outside the usual range (0 included). */
function unusualMultipliers(name: string, list: readonly { readonly multiplier: number }[]): Found[] {
  return list.flatMap((r, i): Found[] =>
    r.multiplier < USUAL_MULTIPLIER_RANGE.min || r.multiplier > USUAL_MULTIPLIER_RANGE.max
      ? [
          {
            field: `${name}[${i}].multiplier`,
            severity: 'warning',
            message: `${r.multiplier} is outside the usual range ${USUAL_MULTIPLIER_RANGE.min}–${USUAL_MULTIPLIER_RANGE.max}`,
          },
        ]
      : [],
  );
}

/** "a beginner", "an advanced": tier names are lowercase words, so a vowel letter is a vowel sound. */
function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
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
        ...(entry.data.capacityCost === TIER_CAPACITY_COST[entry.data.tier]
          ? []
          : [{ field: 'capacityCost', message: `must be ${TIER_CAPACITY_COST[entry.data.tier]} for ${withArticle(entry.data.tier)} class` }]),
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
        ...(entry.data.weapon !== undefined && kinds.size === 0
          ? [{ field: 'damageSplit', message: 'a weapon needs at least 1 damage kind' }]
          : []),
        ...(entry.data.armor === undefined
          ? []
          : [
              ...repeatedKinds('armor.resistances', entry.data.armor.resistances),
              ...unusualMultipliers('armor.resistances', entry.data.armor.resistances),
            ]),
      ];
    }
    case 'enemies':
      return [
        ...repeats(
          entry.data.attacks,
          (a) => a.id,
          (i) => `attacks[${i}].id`,
          (k) => `repeated attack id "${k}"`,
        ),
        ...entry.data.attacks.flatMap((a, i) => repeatedKinds(`attacks[${i}].damage`, a.damage)),
        ...repeatedKinds('resistances', entry.data.resistances),
        ...unusualMultipliers('resistances', entry.data.resistances),
      ];
    case 'presets': {
      const total = entry.data.birthPoints.reduce((sum, b) => sum + b.points, 0);
      return [
        ...repeats(
          entry.data.birthPoints,
          (b) => b.attribute,
          (i) => `birthPoints[${i}].attribute`,
          (k) => `repeated attribute "${k}"`,
        ),
        ...(total === BIRTH_POINTS
          ? []
          : [{ field: 'birthPoints', message: `must total ${BIRTH_POINTS}, found ${total}` }]),
      ];
    }
    case 'arenas':
      return rulesForArena(entry.data);
    case 'waves': {
      const first = new Map<string, number>();
      return entry.data.enemies.flatMap((e, i): Found[] => {
        const key = describeTile(e);
        const earlier = first.get(key);
        if (earlier === undefined) {
          first.set(key, i);
          return [];
        }
        return [{ field: `enemies[${i}]`, message: `repeated tile ${key}, also used by enemies[${earlier}]` }];
      });
    }
  }
}

/** "(3, 4)", as the checker writes a tile in its messages. */
function describeTile(t: { readonly x: number; readonly y: number }): string {
  return `(${t.x}, ${t.y})`;
}

/** What is at a tile of an arena: a wall, floor, or nothing (outside the rows). */
function tileAt(arena: ArenaContent, t: { readonly x: number; readonly y: number }): string | undefined {
  return arena.rows[t.y]?.[t.x];
}

function rulesForArena(arena: ArenaContent): Found[] {
  const found: Found[] = [];
  const width = arena.rows[0]?.length ?? 0;
  arena.rows.forEach((row, y) => {
    if (row.length !== width) {
      found.push({ field: `rows[${y}]`, message: `is ${row.length} characters long, expected ${width} like the first row` });
    }
    const bad = [...row].findIndex((c) => c !== WALL && c !== FLOOR);
    if (bad !== -1) found.push({ field: `rows[${y}]`, message: `unknown tile "${row[bad]}" at column ${bad} (use ${WALL} or ${FLOOR})` });
  });

  const { campfire, spawn } = arena;
  const campfireTile = tileAt(arena, campfire);
  if (campfireTile === undefined) found.push({ field: 'campfire', message: `${describeTile(campfire)} is outside the arena` });
  else if (campfireTile === WALL) found.push({ field: 'campfire', message: `${describeTile(campfire)} is a wall` });

  if (tileAt(arena, spawn) !== FLOOR) {
    found.push({ field: 'spawn', message: `${describeTile(spawn)} is not a walkable tile` });
  } else if (Math.max(Math.abs(spawn.x - campfire.x), Math.abs(spawn.y - campfire.y)) !== 1) {
    found.push({ field: 'spawn', message: `${describeTile(spawn)} must be next to the campfire ${describeTile(campfire)}` });
  }
  return found;
}

// ---- Step 6: the rules across files ------------------------------------------------------------------

interface Loaded {
  readonly file: string;
  readonly entry: Entry;
}

function rulesAcrossFiles(loaded: readonly Loaded[]): ContentProblem[] {
  const found: ContentProblem[] = [];
  const add = (file: string, field: string, message: string) => found.push({ file, field, severity: 'error', message });

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
  const presetIds = idsOf('presets');
  const enemyIds = idsOf('enemies');
  const items = new Map<string, ItemContent>();
  const arenas = new Map<string, ArenaContent>();
  for (const { entry } of loaded) {
    if (entry.kind === 'items') items.set(entry.data.id, entry.data);
    if (entry.kind === 'arenas') arenas.set(entry.data.id, entry.data);
  }

  /** A preset's weapon or armor: the item must exist and have the `part` it is used as. */
  const checkGear = (file: string, field: 'weapon' | 'armor', itemId: string | null) => {
    if (itemId === null) return;
    const item = items.get(itemId);
    if (item === undefined) add(file, field, `no item with id "${itemId}"`);
    else if (item[field] === undefined) add(file, field, `"${itemId}" is not ${field === 'weapon' ? 'a weapon' : 'armor'}`);
  };

  for (const { file, entry } of loaded) {
    switch (entry.kind) {
      case 'classes':
        entry.data.startingAbilities.forEach((abilityId, i) => {
          if (!abilityIds.has(abilityId)) add(file, `startingAbilities[${i}]`, `no ability with id "${abilityId}"`);
        });
        entry.data.prerequisites.forEach((p, i) => {
          const field = `prerequisites[${i}].classId`;
          if (p.classId === entry.data.id) add(file, field, "a class can't require itself");
          else if (!classIds.has(p.classId)) add(file, field, `no class with id "${p.classId}"`);
        });
        break;
      case 'presets':
        checkGear(file, 'weapon', entry.data.weapon);
        checkGear(file, 'armor', entry.data.armor);
        break;
      case 'arenas':
        if (!presetIds.has(entry.data.startingPreset)) {
          add(file, 'startingPreset', `no preset with id "${entry.data.startingPreset}"`);
        }
        break;
      case 'waves': {
        const arena = arenas.get(entry.data.arena);
        if (arena === undefined) add(file, 'arena', `no arena with id "${entry.data.arena}"`);
        entry.data.enemies.forEach((e, i) => {
          if (!enemyIds.has(e.enemy)) add(file, `enemies[${i}].enemy`, `no enemy with id "${e.enemy}"`);
          if (arena === undefined) return;
          const where = describeTile(e);
          if (tileAt(arena, e) === undefined) add(file, `enemies[${i}]`, `${where} is outside the arena`);
          else if (tileAt(arena, e) === WALL) add(file, `enemies[${i}]`, `${where} is a wall`);
          else if (e.x === arena.campfire.x && e.y === arena.campfire.y) add(file, `enemies[${i}]`, `${where} is the campfire`);
          else if (e.x === arena.spawn.x && e.y === arena.spawn.y) add(file, `enemies[${i}]`, `${where} is the spawn tile`);
        });
        break;
      }
      default:
        break;
    }
  }
  return found;
}

// ---- The checker ------------------------------------------------------------------------------------

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A file that was read as its kind and passed the shape check (it may still have other problems). */
export type ContentEntry = Entry;

/**
 * Checks every file and returns the problems, sorted by file, then field, then message, together with
 * the entries that could be read as their kind. Files that can't (bad path, bad JSON, wrong shape) are
 * left out of the entries and of the cross-file checks.
 */
export function checkAndParse(files: readonly ContentFile[]): { problems: ContentProblem[]; entries: ContentEntry[] } {
  const problems: ContentProblem[] = [];
  const loaded: Loaded[] = [];

  // Path order, so "the first file to use an id" doesn't depend on the order the caller listed them.
  const ordered = [...files].sort((a, b) => byText(a.path, b.path));

  for (const { path, text } of ordered) {
    const report = (found: readonly Found[]) => {
      for (const f of found) problems.push({ file: path, severity: 'error', ...f });
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

  problems.sort((a, b) => byText(a.file, b.file) || byText(a.field, b.field) || byText(a.message, b.message));
  return { problems, entries: loaded.map((l) => l.entry) };
}

/** Checks every file and returns the problems, sorted by file, then field, then message. */
export function checkContent(files: readonly ContentFile[]): ContentProblem[] {
  return checkAndParse(files).problems;
}
