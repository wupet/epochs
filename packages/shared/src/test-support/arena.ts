/**
 * Test support only: small builders for fights on the real arena. Game code must never import it.
 */
import { createArenaWorld, maxHealthOf, newSheet, startWave, step } from '../index';
import type { Character, Enemy, Intention, Tile, WorldState } from '../index';
import { realContent } from './real-content';

export const content = realContent();

export function t(x: number, y: number): Tile {
  return { x, y };
}

export function attack(characterId: number, enemyId: number, subtick = 0): Intention {
  return { kind: 'attack', characterId, enemyId, subtick };
}

export function attackMove(characterId: number, target: Tile, subtick = 0): Intention {
  return { kind: 'attack-move', characterId, target, subtick };
}

export function move(characterId: number, target: Tile, subtick = 0): Intention {
  return { kind: 'move', characterId, target, subtick };
}

/**
 * The arena (seed 7 unless given): players 1..n join at the spawn, then the wave starts (so its
 * enemies stand exactly where they were placed, not one tick into a chase), then each player is put
 * on the given tile.
 */
export function arenaWith(waveId: string, tiles: readonly Tile[], seed = 7): WorldState {
  const joins = tiles.map((_, i): Intention => ({ kind: 'join', characterId: i + 1, subtick: 0 }));
  const joined = startWave(step(createArenaWorld(content, 'arena', seed), joins), waveId);
  return { ...joined, characters: joined.characters.map((c, i) => ({ ...c, tile: tiles[i]! })) };
}

export function characterOf(state: WorldState, id: number): Character {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character;
}

export function enemyOf(state: WorldState, id: number): Enemy {
  const enemy = state.enemies.find((e) => e.id === id);
  if (!enemy) throw new Error(`No enemy ${id}`);
  return enemy;
}

export function withCharacter(state: WorldState, id: number, change: Partial<Character>): WorldState {
  return { ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

export function withEnemy(state: WorldState, id: number, change: Partial<Enemy>): WorldState {
  return { ...state, enemies: state.enemies.map((e) => (e.id === id ? { ...e, ...change } : e)) };
}

/** A player switched to a preset's sheet, at its full health. */
export function withPreset(state: WorldState, id: number, presetId: string): WorldState {
  const sheet = newSheet(content, presetId);
  return withCharacter(state, id, { sheet, health: maxHealthOf(sheet, content) });
}

export function withoutEnemy(state: WorldState, id: number): WorldState {
  return { ...state, enemies: state.enemies.filter((e) => e.id !== id) };
}

/** Steps through the given ticks of intentions; returns every state after the first, in order. */
export function run(start: WorldState, ticks: readonly (readonly Intention[])[]): WorldState[] {
  const states: WorldState[] = [];
  let world = start;
  for (const intentions of ticks) {
    world = step(world, intentions);
    states.push(world);
  }
  return states;
}

export function quiet(count: number): Intention[][] {
  return Array.from({ length: count }, () => []);
}
