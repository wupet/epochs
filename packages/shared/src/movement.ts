/**
 * Movement speed. A speed is a whole number of millitiles (thousandths of a tile) added to a
 * character's progress every tick; each step costs `STEP` of progress. Whole numbers keep the
 * arithmetic exact, so the same inputs always give the same world.
 */

/** Millitiles in one tile: the progress one step costs. */
export const STEP = 1000;

/** The most tiles a character may enter in one tick. */
export const MAX_STEPS_PER_TICK = 2;

/** The fastest speed allowed: `MAX_STEPS_PER_TICK` tiles every tick. */
export const MAX_SPEED = STEP * MAX_STEPS_PER_TICK;

/**
 * Debug movement modes, for testing feel. Running and riding get real rules later. Speeds are in
 * millitiles per tick: walk is a tile every 2 ticks, run a tile every tick, horse 2 tiles every tick.
 */
export const DEBUG_MOVEMENT_MODES = { walk: 500, run: 1000, horse: 2000 } as const;

export type DebugMovementMode = keyof typeof DEBUG_MOVEMENT_MODES;

/** Every character starts out walking. */
export const DEFAULT_SPEED = DEBUG_MOVEMENT_MODES.walk;

/** True only for the debug mode names themselves, never for inherited keys like 'toString'. */
export function isDebugMovementMode(value: unknown): value is DebugMovementMode {
  return typeof value === 'string' && Object.hasOwn(DEBUG_MOVEMENT_MODES, value);
}
