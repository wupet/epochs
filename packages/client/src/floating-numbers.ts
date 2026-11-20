/**
 * Damage numbers that float up from a target for a moment. Only hits you dealt or took are shown.
 * Pure: time is passed in as `nowMs`, and nothing here touches the DOM.
 */
import type { HitView, Ref } from '@epochs/shared';
import type { Point } from './motion';

/** How long a number stays on screen, in ms. */
export const FLOAT_MS = 900;

/** One number: where the target was drawn when the hit arrived, and when that was. */
export interface FloatingNumber {
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly mine: 'dealt' | 'taken';
  readonly bornMs: number;
}

/**
 * A new list with a number added for each hit where `you` is the attacker ('dealt') or the target
 * ('taken'). `positions` says where a target is drawn right now; a target it does not know is skipped.
 */
export function addHits(
  list: readonly FloatingNumber[],
  hits: readonly HitView[],
  you: number,
  positions: (target: Ref) => Point | undefined,
  nowMs: number,
): FloatingNumber[] {
  const next = [...list];
  for (const hit of hits) {
    const dealt = hit.attacker.side === 'player' && hit.attacker.id === you;
    const taken = hit.target.side === 'player' && hit.target.id === you;
    if (!dealt && !taken) continue;
    const at = positions(hit.target);
    if (at === undefined) continue;
    next.push({ x: at.x, y: at.y, amount: hit.amount, mine: dealt ? 'dealt' : 'taken', bornMs: nowMs });
  }
  return next;
}

/** The numbers still on screen at `nowMs`. */
export function visible(list: readonly FloatingNumber[], nowMs: number): FloatingNumber[] {
  return list.filter((n) => nowMs - n.bornMs < FLOAT_MS);
}
