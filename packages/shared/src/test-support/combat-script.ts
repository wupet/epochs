/**
 * Test support only: a scripted fight on the real arena, for the determinism test (and, later, the
 * protocol's hidden-information test). It covers the practice wave, an attack on the dummy, a chase,
 * attack-moves, a player who goes down and respawns, and wave 1. Game code must never import it.
 */
import { createArenaWorld, step } from '../index';
import type { Intention, Tile, WorldState } from '../index';
import { content } from './arena';

/** How many ticks the script runs. */
export const COMBAT_SCRIPT_TICKS = 200;

/** The practice wave's enemies: the dummy, then the slime. Wave 1's slimes get ids 3, 4 and 5. */
export const SCRIPT_DUMMY = 1;
export const SCRIPT_SLIME = 2;
export const SCRIPT_WAVE_1_IDS: readonly number[] = [3, 4, 5];

function t(x: number, y: number): Tile {
  return { x, y };
}

function debug(characterId: number, fields: Record<string, unknown>): Intention {
  return { characterId, subtick: 0, ...fields } as unknown as Intention;
}

/** The intentions for each tick, by tick number. */
export function combatScript(): Intention[][] {
  const ticks: Intention[][] = Array.from({ length: COMBAT_SCRIPT_TICKS }, () => []);
  ticks[0] = [1, 2, 3].map((id): Intention => ({ kind: 'join', characterId: id, subtick: 0 }));
  ticks[1] = [
    debug(1, { kind: 'debug-start-wave', waveId: 'practice' }),
    debug(2, { kind: 'debug-preset', presetId: 'hunter' }),
    debug(3, { kind: 'debug-armor', itemId: null }),
  ];
  ticks[2] = [
    { kind: 'attack', characterId: 1, enemyId: SCRIPT_DUMMY, subtick: 0 },
    { kind: 'attack-move', characterId: 2, target: t(16, 10), subtick: 0 },
    { kind: 'attack', characterId: 3, enemyId: SCRIPT_SLIME, subtick: 0 },
  ];
  ticks[30] = [{ kind: 'attack-move', characterId: 1, target: t(3, 18), subtick: 0 }];
  // Wave 1, with player 3 unarmed and unarmoured walking in among the slimes, the others far off.
  ticks[40] = [
    debug(2, { kind: 'debug-start-wave', waveId: 'wave-1' }),
    debug(3, { kind: 'debug-weapon', itemId: null }),
    { kind: 'move', characterId: 3, target: t(12, 5), subtick: 0 },
    { kind: 'move', characterId: 1, target: t(2, 21), subtick: 0 },
    { kind: 'move', characterId: 2, target: t(21, 21), subtick: 0 },
  ];
  ticks[120] = [
    debug(3, { kind: 'debug-weapon', itemId: 'rusty-shortsword' }),
    { kind: 'attack-move', characterId: 1, target: t(12, 4), subtick: 0 },
    { kind: 'attack-move', characterId: 2, target: t(12, 4), subtick: 0 },
    { kind: 'attack-move', characterId: 3, target: t(12, 4), subtick: 1 },
  ];
  return ticks;
}

/** Runs the script on the arena with this seed; returns the start state and the state after every tick. */
export function runCombatScript(seed: number): WorldState[] {
  let world = createArenaWorld(content, 'arena', seed);
  const states: WorldState[] = [world];
  for (const intentions of combatScript()) {
    world = step(world, intentions);
    states.push(world);
  }
  return states;
}
