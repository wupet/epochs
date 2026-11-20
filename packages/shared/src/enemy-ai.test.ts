import { describe, expect, it } from 'vitest';
import { chooseEnemyOrders, nearness, step } from './index';
import type { WorldState } from './index';
import {
  arenaWith,
  attack,
  characterOf,
  enemyOf,
  run,
  quiet,
  t,
  withCharacter,
  withEnemy,
  withPreset,
} from './test-support/arena';

/** The practice wave's enemies: the dummy at (8,4), then the slime at (15,4). */
const DUMMY = 1;
const SLIME = 2;
const A = 1;
const B = 2;

/** The order the placeholder AI gives an enemy. */
function orderOf(state: WorldState, enemyId: number) {
  const index = state.enemies.findIndex((e) => e.id === enemyId);
  return chooseEnemyOrders(state)[index];
}

/** A near (2 tiles from the slime) and B far (5 tiles, a hunter in bow range). */
function nearAndFar(): WorldState {
  return withPreset(arenaWith('practice', [t(15, 6), t(15, 9)]), B, 'hunter');
}

describe('chooseEnemyOrders (the placeholder AI)', () => {
  it('gives one order per enemy, in enemy order; the dummy idles', () => {
    const state = nearAndFar();
    const orders = chooseEnemyOrders(state);
    expect(state.enemies.map((e) => e.id)).toEqual([DUMMY, SLIME]);
    expect(orders).toEqual([{ kind: 'idle' }, { kind: 'chase', target: A }]);
  });

  it('chases the nearest player, and walks toward them', () => {
    const start = nearAndFar();
    expect(nearness(t(15, 6), t(15, 4))).toBeLessThan(nearness(t(15, 9), t(15, 4)));
    expect(orderOf(start, SLIME)).toEqual({ kind: 'chase', target: A });
    const after = step(start, []);
    expect(nearness(enemyOf(after, SLIME).tile, t(15, 6))).toBe(1);
  });

  it('ties go to the lower id', () => {
    const state = arenaWith('practice', [t(15, 7), t(15, 1)]);
    expect(orderOf(state, SLIME)).toEqual({ kind: 'chase', target: 1 });
  });

  it('after B hits it, it chases B', () => {
    const start = nearAndFar();
    const hit = step(start, [attack(B, SLIME)]);
    expect(hit.hits.some((h) => h.attacker.id === B && h.target.id === SLIME && h.amount > 0)).toBe(true);
    expect(enemyOf(hit, SLIME).lastDamagedBy).toBe(B);
    expect(orderOf(hit, SLIME)).toEqual({ kind: 'chase', target: B });
  });

  it("after B dies, it chases the nearest player who isn't down: A, even though B's body is nearer", () => {
    let state = withEnemy(nearAndFar(), SLIME, { lastDamagedBy: B });
    state = withCharacter(state, B, { tile: t(16, 4), health: 0 });
    state = withCharacter(state, A, { tile: t(15, 8) });
    const dead = step(state, []);
    expect(characterOf(dead, B).respawnTick).not.toBeNull();
    expect(characterOf(dead, B).tile).toEqual(t(16, 4));
    const slime = enemyOf(dead, SLIME);
    expect(nearness(slime.tile, t(16, 4))).toBeLessThan(nearness(slime.tile, characterOf(dead, A).tile));
    expect(orderOf(dead, SLIME)).toEqual({ kind: 'chase', target: A });
    // The AI's own rule, even if the enemy still remembered B: a down player is never a target.
    expect(orderOf(withEnemy(dead, SLIME, { lastDamagedBy: B }), SLIME)).toEqual({ kind: 'chase', target: A });
  });

  it('after B leaves, it chases A, even though B was nearer and its last damager', () => {
    let state = withEnemy(nearAndFar(), SLIME, { lastDamagedBy: B });
    state = withCharacter(state, B, { tile: t(16, 4) });
    expect(orderOf(state, SLIME)).toEqual({ kind: 'chase', target: B });
    const left = step(state, [{ kind: 'leave', characterId: B, subtick: 0 }]);
    expect(enemyOf(left, SLIME).lastDamagedBy).toBe(B); // remembered, but B is gone
    expect(orderOf(left, SLIME)).toEqual({ kind: 'chase', target: A });
  });

  it('with no player who can be targeted, every enemy idles', () => {
    let state = arenaWith('practice', [t(15, 6)]);
    state = withCharacter(state, A, { health: 0, respawnTick: state.tick + 5 });
    expect(chooseEnemyOrders(state)).toEqual([{ kind: 'idle' }, { kind: 'idle' }]);
    const states = run(state, quiet(3));
    for (const s of states) expect(enemyOf(s, SLIME).tile).toEqual(t(15, 4));
  });

  it('an enemy with zero speed idles', () => {
    const state = withEnemy(arenaWith('practice', [t(15, 6)]), SLIME, { speed: 0 });
    expect(orderOf(state, SLIME)).toEqual({ kind: 'idle' });
  });
});
