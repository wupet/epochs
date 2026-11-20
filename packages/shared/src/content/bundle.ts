/**
 * The checked content, as the game rules use it: one record per kind, keyed by id. No Zod in here
 * (type-only imports are erased), so any module may import it.
 */
import type { ArenaContent, ClassContent, EnemyContent, ItemContent, PresetContent, WaveContent } from './schemas';

export interface ContentBundle {
  readonly classes: Readonly<Record<string, ClassContent>>;
  readonly items: Readonly<Record<string, ItemContent>>;
  readonly enemies: Readonly<Record<string, EnemyContent>>;
  readonly presets: Readonly<Record<string, PresetContent>>;
  readonly arenas: Readonly<Record<string, ArenaContent>>;
  readonly waves: Readonly<Record<string, WaveContent>>;
}

/** No content at all, for tests and code that doesn't use any. */
export const EMPTY_CONTENT: ContentBundle = {
  classes: {},
  items: {},
  enemies: {},
  presets: {},
  arenas: {},
  waves: {},
};

/**
 * Finds an id in a record, or `undefined`. Own properties only: `"constructor"` and `"toString"` match
 * the id pattern, and plain indexing (or \`in\`) would find them on \`Object.prototype\`.
 */
export function lookup<T>(record: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}
