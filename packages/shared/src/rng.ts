/**
 * The seeded random generator (mulberry32). Pure: the whole state is one 32-bit number that the
 * caller keeps (`WorldState.rng`) and passes back in, so the same seed always gives the same rolls.
 */
import { SPREAD_PERCENT } from './damage';

/** One step of mulberry32: a value from 0 to 2^32 - 1, and the next state (also a 32-bit whole number). */
export function nextRandom(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: (t ^ (t >>> 14)) >>> 0, state: next >>> 0 };
}

/**
 * One damage spread roll: a whole percent from -SPREAD_PERCENT to +SPREAD_PERCENT (-10 to +10),
 * the generator value mod 21 minus 10. The bias from the modulo is below one part in 200 million.
 */
export function rollSpread(state: number): { percent: number; state: number } {
  const roll = nextRandom(state);
  return { percent: (roll.value % (2 * SPREAD_PERCENT + 1)) - SPREAD_PERCENT, state: roll.state };
}
