/**
 * `buildContentBundle`: checks the content files and, if there is no error, turns them into the bundle
 * the game rules use. Pure, like the checker: it takes file contents and never reads the file system.
 */
import { checkAndParse } from './check';
import type { ContentFile, ContentProblem } from './check';
import type { ContentBundle } from './bundle';
import type { ArenaContent, ClassContent, EnemyContent, ItemContent, PresetContent, WaveContent } from './schemas';

/**
 * Checks `files`. The bundle is `null` if any problem is an error; warnings alone still give a bundle.
 * The problems (warnings included) come back either way.
 */
export function buildContentBundle(files: readonly ContentFile[]): { bundle: ContentBundle | null; problems: ContentProblem[] } {
  const { problems, entries } = checkAndParse(files);
  if (problems.some((p) => p.severity === 'error')) return { bundle: null, problems };

  const classes: Record<string, ClassContent> = {};
  const items: Record<string, ItemContent> = {};
  const enemies: Record<string, EnemyContent> = {};
  const presets: Record<string, PresetContent> = {};
  const arenas: Record<string, ArenaContent> = {};
  const waves: Record<string, WaveContent> = {};
  for (const entry of entries) {
    switch (entry.kind) {
      case 'classes':
        classes[entry.data.id] = entry.data;
        break;
      case 'items':
        items[entry.data.id] = entry.data;
        break;
      case 'enemies':
        enemies[entry.data.id] = entry.data;
        break;
      case 'presets':
        presets[entry.data.id] = entry.data;
        break;
      case 'arenas':
        arenas[entry.data.id] = entry.data;
        break;
      case 'waves':
        waves[entry.data.id] = entry.data;
        break;
      case 'abilities':
        // Abilities are checked but not part of the bundle yet: nothing in the game uses them.
        break;
    }
  }
  return { bundle: { classes, items, enemies, presets, arenas, waves }, problems };
}
