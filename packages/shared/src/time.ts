/**
 * The world's clocks. See CLAUDE.md, "Key numbers".
 */

/** One tick: the world advances one step. Movement is one tile per tick at base speed. */
export const TICK_MS = 250;

/** Subticks order actions within a tick; faster characters act on earlier subticks. */
export const SUBTICKS_PER_TICK = 10;

/** Length of one subtick. */
export const SUBTICK_MS = TICK_MS / SUBTICKS_PER_TICK;

/** Macro tick: world simulation (kingdoms, armies, threats). */
export const MACRO_TICK_MS = 60_000;
