/**
 * Keyboard shortcut rules. Pure: no DOM types, so it can be tested without a browser.
 */

const FORM_TAGS: ReadonlySet<string> = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

/**
 * True if a key event's target is a form control (input, select, textarea or button). Game shortcuts
 * ignore such events, so typing in or operating the debug panel never moves the game.
 */
export function isFormControl(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const tag = (target as { readonly tagName?: unknown }).tagName;
  return typeof tag === 'string' && FORM_TAGS.has(tag.toUpperCase());
}

/** What a left click on the map asks for. */
export type ClickAction =
  | { readonly kind: 'attack'; readonly enemyId: number }
  | { readonly kind: 'attack-move' }
  | { readonly kind: 'move' };

/**
 * A click on a tile: an enemy there is attacked (armed or not); otherwise attack-move if armed, else
 * a plain move. Arming is spent by any click, which the caller handles.
 */
export function clickAction(armed: boolean, enemyId: number | undefined): ClickAction {
  if (enemyId !== undefined) return { kind: 'attack', enemyId };
  return armed ? { kind: 'attack-move' } : { kind: 'move' };
}
