/**
 * The enemy AI: the Phase 2 placeholder, to be replaced. Smarter enemies and threat come later
 * (Peter, 2026-11-19), so every enemy decision lives here and nowhere else: this file says who each
 * enemy goes after, and the engine (`combat.ts`, `world.ts`) only carries the orders out.
 *
 * The rule (spec "One tick", step 6): an enemy with no attacks or zero speed idles. Otherwise it
 * chases the player who damaged it most recently, if that player is still in the world and not down,
 * or else the nearest player who isn't down (ties go to the lowest id). With no such player it idles.
 *
 * Pure, and reachable from the client, so it imports only Zod-free modules (types are erased).
 */
import { lookup } from './content/bundle';
import { nearness } from './route';
import { isDown } from './waves';
import type { Character, CharacterId, WorldState } from './world';

/** What an enemy does this tick. Never sent to clients. */
export type EnemyOrder = { readonly kind: 'chase'; readonly target: CharacterId } | { readonly kind: 'idle' };

const IDLE: EnemyOrder = { kind: 'idle' };

/** One order per enemy, in `state.enemies` order. */
export function chooseEnemyOrders(state: WorldState): readonly EnemyOrder[] {
  const targets = state.characters.filter((c) => !isDown(c));
  return state.enemies.map((enemy): EnemyOrder => {
    const content = lookup(state.content.enemies, enemy.contentId);
    if (!content || content.attacks.length === 0 || enemy.speed === 0) return IDLE;
    const damager = targets.find((c) => c.id === enemy.lastDamagedBy);
    const target = damager ?? nearestOf(targets, enemy.tile);
    return target ? { kind: 'chase', target: target.id } : IDLE;
  });
}

/** The nearest of these players (sorted by id) to a tile; ties go to the lowest id. */
function nearestOf(players: readonly Character[], tile: Character['tile']): Character | undefined {
  let nearest: Character | undefined;
  for (const c of players) {
    if (nearest === undefined || nearness(c.tile, tile) < nearness(nearest.tile, tile)) nearest = c;
  }
  return nearest;
}
