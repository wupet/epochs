/**
 * The tick pulse: a subtle brightness flash each time a tick arrives, so the tick rhythm can be
 * felt. Pure: no clock, no DOM.
 */

/** How strong the flash is at the moment a tick arrives. 0 disables it. */
export const PULSE_STRENGTH = 0.12;

/** How long the flash lasts, in ms. */
export const PULSE_MS = 120;

/** The flash level `msSinceTick` after a tick: `strength` at 0 ms, falling linearly to 0 at PULSE_MS. */
export function pulseLevel(msSinceTick: number, strength: number = PULSE_STRENGTH): number {
  if (strength <= 0 || msSinceTick >= PULSE_MS) return 0;
  const t = Math.max(0, msSinceTick) / PULSE_MS;
  return strength * (1 - t);
}

/** The pulse is off unless the page address says `?pulse=1` or `?pulse=on`. */
export function pulseEnabledFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get('pulse');
  return value === '1' || value === 'on';
}
