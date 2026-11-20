import { describe, expect, it } from 'vitest';
import {
  RECAP_HITS,
  attributesOf,
  canStrike,
  computeDamage,
  createArenaWorld,
  inReach,
  maxHealthOf,
  nearness,
  newSheet,
  rollSpread,
  sameTile,
  startWave,
  step,
} from './index';
import type { Character, Enemy, Hit, Intention, Tile, WorldState } from './index';
import { realContent } from './test-support/real-content';

const content = realContent();

/** The practice wave's enemies: the dummy at (8,4), then the slime at (15,4). */
const DUMMY = 1;
const SLIME = 2;

function t(x: number, y: number): Tile {
  return { x, y };
}

function attack(characterId: number, enemyId: number, subtick = 0): Intention {
  return { kind: 'attack', characterId, enemyId, subtick };
}

function attackMove(characterId: number, target: Tile, subtick = 0): Intention {
  return { kind: 'attack-move', characterId, target, subtick };
}

function move(characterId: number, target: Tile, subtick = 0): Intention {
  return { kind: 'move', characterId, target, subtick };
}

/** The arena (seed 7) with the practice wave, then players 1..n joined and placed on the given tiles. */
function practiceWith(tiles: readonly Tile[], seed = 7): WorldState {
  const world = startWave(createArenaWorld(content, 'arena', seed), 'practice');
  const joins = tiles.map((_, i): Intention => ({ kind: 'join', characterId: i + 1, subtick: 0 }));
  const joined = step(world, joins);
  return { ...joined, characters: joined.characters.map((c, i) => ({ ...c, tile: tiles[i]! })) };
}

function characterOf(state: WorldState, id: number): Character {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character;
}

function enemyOf(state: WorldState, id: number): Enemy {
  const enemy = state.enemies.find((e) => e.id === id);
  if (!enemy) throw new Error(`No enemy ${id}`);
  return enemy;
}

function withCharacter(state: WorldState, id: number, change: Partial<Character>): WorldState {
  return { ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, ...change } : c)) };
}

function withEnemy(state: WorldState, id: number, change: Partial<Enemy>): WorldState {
  return { ...state, enemies: state.enemies.map((e) => (e.id === id ? { ...e, ...change } : e)) };
}

function withPreset(state: WorldState, id: number, presetId: string): WorldState {
  const sheet = newSheet(content, presetId);
  return withCharacter(state, id, { sheet, health: maxHealthOf(sheet, content) });
}

/**
 * The amount a player's basic attack on an enemy deals, from the state before the hit, with the
 * spread rolled from `rng` (the state's generator unless given): never a hard-coded spread.
 */
function expectedHit(before: WorldState, playerId: number, enemyId: number, rng = before.rng) {
  const player = characterOf(before, playerId);
  const enemy = enemyOf(before, enemyId);
  const weapon = content.items[player.sheet.weaponId!]!;
  const spread = rollSpread(rng);
  const amount = computeDamage({
    damage: weapon.damageSplit,
    attacker: { attributes: attributesOf(player.sheet, content), level: player.sheet.level },
    spreadPercent: spread.percent,
    resistances: content.enemies[enemy.contentId]!.resistances,
    armor: 0,
  });
  return { amount, rng: spread.state };
}

/** Steps through the given ticks of intentions; returns every state after the first, in order. */
function run(start: WorldState, ticks: readonly (readonly Intention[])[]): WorldState[] {
  const states: WorldState[] = [];
  let world = start;
  for (const intentions of ticks) {
    world = step(world, intentions);
    states.push(world);
  }
  return states;
}

function quiet(count: number): Intention[][] {
  return Array.from({ length: count }, () => []);
}

describe('basic attacks: melee', () => {
  it('a militia next to the dummy hits on ticks t, t+4 and t+8, each for the formula amount', () => {
    const start = practiceWith([t(9, 4)]);
    const t0 = start.tick;
    const states = run(start, [[attack(1, DUMMY)], ...quiet(8)]);
    const hits = states.flatMap((s) => s.hits);
    expect(hits.map((h) => h.tick)).toEqual([t0, t0 + 4, t0 + 8]);

    expect(states[0]!.hits[0]).toEqual({
      tick: t0,
      attacker: { side: 'player', id: 1 },
      target: { side: 'enemy', id: DUMMY },
      amount: expectedHit(start, 1, DUMMY).amount,
      attackerName: 'Player 1',
      attackName: 'Rusty Shortsword',
      telegraph: null,
    });
    // Every hit: the amount from the state before it, and exactly one spread roll.
    let before = start;
    for (const after of states) {
      if (after.hits.length > 0) {
        const expected = expectedHit(before, 1, DUMMY);
        expect(after.hits[0]!.amount).toBe(expected.amount);
        expect(after.rng).toBe(expected.rng);
      } else {
        expect(after.rng).toBe(before.rng);
      }
      before = after;
    }
    const dummy = enemyOf(states[8]!, DUMMY);
    expect(dummy.health).toBe(1000 - hits.reduce((sum, h) => sum + h.amount, 0));
    expect(dummy.lastDamagedBy).toBe(1);
    expect(dummy.lastHitTick).toBe(t0 + 8);
    // The dummy never moves.
    for (const s of states) expect(enemyOf(s, DUMMY).tile).toEqual(t(8, 4));
  });

  it('the interval holds: walking away at t+1 and coming back at t+2 gives no hit before t+4', () => {
    const running = step(practiceWith([t(9, 4)]), [{ kind: 'mode', characterId: 1, mode: 'run', subtick: 0 }]);
    const t0 = running.tick;
    const states = run(running, [[attack(1, DUMMY)], [move(1, t(10, 4))], [attack(1, DUMMY)], [], []]);
    expect(states.map((s) => s.hits.length)).toEqual([1, 0, 0, 0, 1]);
    expect(states[4]!.hits[0]!.tick).toBe(t0 + 4);
    // Out of reach at t+1, back in reach at t+2 and t+3, yet no hit until the interval is up.
    expect(characterOf(states[1]!, 1).tile).toEqual(t(10, 4));
    for (const i of [2, 3]) {
      expect(inReach(running.grid, characterOf(states[i]!, 1).tile, t(8, 4), 1)).toBe(true);
    }
  });

  it('chasing: an attack on the slime 5 tiles away walks, then hits on the first tick it is in reach', () => {
    const start = practiceWith([t(10, 4)]);
    expect(nearness(t(10, 4), enemyOf(start, SLIME).tile)).toBe(5);
    const states = run(start, [[attack(1, SLIME)], ...quiet(14)]);
    const firstInReach = states.findIndex((s) => inReach(s.grid, characterOf(s, 1).tile, enemyOf(s, SLIME).tile, 1));
    expect(firstInReach).toBeGreaterThan(0);
    for (const s of states.slice(0, firstInReach)) expect(s.hits).toEqual([]);
    const hitState = states[firstInReach]!;
    expect(hitState.hits).toHaveLength(1);
    expect(hitState.hits[0]!.target).toEqual({ side: 'enemy', id: SLIME });
    expect(hitState.hits[0]!.amount).toBe(expectedHit(states[firstInReach - 1]!, 1, SLIME).amount);
    // Standing still once in reach.
    expect(characterOf(states[firstInReach + 1]!, 1).tile).toEqual(characterOf(hitState, 1).tile);
  });

  it('corners: no strike diagonally past a pillar corner; the player steps to an orthogonal tile first', () => {
    // The pillar covers (11,10)-(12,11): from (10,11) the slime on (11,12) is diagonal past its corner.
    let start = withEnemy(practiceWith([t(10, 11)]), SLIME, { tile: t(11, 12) });
    start = withCharacter(start, 1, { progress: 0 }); // so the first step comes two ticks later
    expect(canStrike(start.grid, t(10, 11), t(11, 12))).toBe(false);
    const states = run(start, [[attack(1, SLIME)], ...quiet(4)]);
    const firstHit = states.findIndex((s) => s.hits.length > 0);
    expect(firstHit).toBeGreaterThan(0);
    for (const s of states.slice(0, firstHit)) {
      expect(s.hits).toEqual([]);
      expect(characterOf(s, 1).tile).toEqual(t(10, 11));
    }
    const at = characterOf(states[firstHit]!, 1).tile;
    expect(at).not.toEqual(t(10, 11));
    expect(nearness(at, t(11, 12))).toBe(1);
    expect(at.x === 11 || at.y === 12).toBe(true); // orthogonal
  });

  it('with no weapon, an attack intention is ignored', () => {
    const start = practiceWith([t(9, 4)]);
    const unarmed = step(start, [{ kind: 'debug-weapon', characterId: 1, itemId: null, subtick: 0 }]);
    expect(characterOf(unarmed, 1).sheet.weaponId).toBeNull();
    const states = run(unarmed, [[attack(1, DUMMY)], ...quiet(4)]);
    for (const s of states) {
      expect(s.hits).toEqual([]);
      expect(characterOf(s, 1).order).toEqual({ kind: 'none' });
      expect(characterOf(s, 1).tile).toEqual(t(9, 4));
    }
  });

  it('builder call: an attack order ends if the weapon is removed mid-chase', () => {
    const start = practiceWith([t(10, 4)]);
    const chasing = step(start, [attack(1, SLIME)]);
    expect(characterOf(chasing, 1).order).toEqual({ kind: 'attack', enemyId: SLIME });
    const after = step(chasing, [{ kind: 'debug-weapon', characterId: 1, itemId: null, subtick: 0 }]);
    expect(characterOf(after, 1).order).toEqual({ kind: 'none' });
    expect(characterOf(after, 1).path).toEqual([]);
  });

  it('builder call: an attack on an enemy not in the world is dropped, so an earlier order stands', () => {
    const start = practiceWith([t(10, 10)]);
    const after = step(start, [move(1, t(10, 15)), attack(1, 99)]);
    expect(characterOf(after, 1).order).toEqual({ kind: 'move', destination: t(10, 15) });
  });
});

describe('basic attacks: ranged', () => {
  it('a hunter with the bow hits from 6 tiles with a clear line, without moving', () => {
    const start = withPreset(practiceWith([t(9, 4)]), 1, 'hunter');
    expect(nearness(t(9, 4), enemyOf(start, SLIME).tile)).toBe(6);
    const after = step(start, [attack(1, SLIME)]);
    expect(after.hits).toHaveLength(1);
    expect(after.hits[0]!.amount).toBe(expectedHit(start, 1, SLIME).amount);
    expect(after.hits[0]!.attackName).toBe('Hunting Bow');
    expect(characterOf(after, 1).tile).toEqual(t(9, 4));
    expect(characterOf(after, 1).stepped).toEqual([]);
  });

  it('with a pillar between, the hunter moves until it has a line, then hits', () => {
    // The pillar (17,6)-(18,7) stands between (18,9) and the slime on (18,4).
    let start = withPreset(practiceWith([t(18, 9)]), 1, 'hunter');
    start = withEnemy(start, SLIME, { tile: t(18, 4) });
    expect(nearness(t(18, 9), t(18, 4))).toBeLessThanOrEqual(6);
    expect(inReach(start.grid, t(18, 9), t(18, 4), 6)).toBe(false);
    const states = run(start, [[attack(1, SLIME)], ...quiet(8)]);
    const firstInReach = states.findIndex((s) => inReach(s.grid, characterOf(s, 1).tile, t(18, 4), 6));
    expect(firstInReach).toBeGreaterThanOrEqual(0);
    for (const s of states.slice(0, firstInReach)) expect(s.hits).toEqual([]);
    expect(states[firstInReach]!.hits).toHaveLength(1);
    expect(characterOf(states[firstInReach]!, 1).tile).not.toEqual(t(18, 9));
  });
});

describe('a target that dies or is cleared mid-chase (Review Focus 1)', () => {
  it('two players on one slime: the second hit lands on its body, then both orders end cleanly', () => {
    let start = practiceWith([t(14, 4), t(16, 4)]);
    start = withEnemy(start, SLIME, { health: 1 });
    const after = step(start, [attack(1, SLIME), attack(2, SLIME)]);
    expect(after.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([
      [1, SLIME],
      [2, SLIME],
    ]);
    const first = expectedHit(start, 1, SLIME);
    const second = expectedHit(start, 2, SLIME, first.rng);
    expect(after.hits.map((h) => h.amount)).toEqual([first.amount, second.amount]);
    expect(after.rng).toBe(second.rng);
    expect(after.enemies.map((e) => e.id)).toEqual([DUMMY]);

    let next: WorldState | undefined;
    expect(() => {
      next = step(after, []);
    }).not.toThrow();
    expect(next!.hits).toEqual([]);
    for (const id of [1, 2]) {
      expect(characterOf(next!, id).order).toEqual({ kind: 'none' });
      expect(characterOf(next!, id).path).toEqual([]);
    }
  });

  it('a wave start during a chase ends the order, and nothing is hit', () => {
    const start = practiceWith([t(10, 4)]);
    const chasing = step(start, [attack(1, SLIME)]);
    expect(characterOf(chasing, 1).path.length).toBeGreaterThan(0);
    const states = run(chasing, [[{ kind: 'debug-start-wave', characterId: 1, waveId: 'wave-1', subtick: 0 }], ...quiet(4)]);
    expect(states[0]!.enemies.some((e) => e.id === SLIME)).toBe(false);
    const stoppedAt = characterOf(states[0]!, 1).tile;
    for (const s of states) {
      expect(s.hits).toEqual([]);
      expect(characterOf(s, 1).order).toEqual({ kind: 'none' });
      expect(characterOf(s, 1).path).toEqual([]);
      expect(characterOf(s, 1).tile).toEqual(stoppedAt);
    }
  });
});

describe('death and respawn', () => {
  function slimeHit(tick: number, amount: number): Hit {
    return {
      tick,
      attacker: { side: 'enemy', id: SLIME },
      target: { side: 'player', id: 1 },
      amount,
      attackerName: 'Slime',
      attackName: 'Touch',
      telegraph: { name: 'Touch', windupTicks: 1 },
    };
  }

  /** Player 1 next to the dummy at 0 health with two recent hits and a move order; the slime last damaged by them. */
  function dying(): WorldState {
    let state = practiceWith([t(9, 4)]);
    state = withCharacter(state, 1, {
      health: 0,
      recentHits: [slimeHit(state.tick - 2, 3), slimeHit(state.tick - 1, 2)],
      order: { kind: 'move', destination: t(9, 8) },
      path: [t(9, 5), t(9, 6), t(9, 7), t(9, 8)],
    });
    return withEnemy(state, SLIME, { lastDamagedBy: 1, lastHitTick: state.tick - 3 });
  }

  it('a player at 0 health goes down where they fell, gets a recap, and is forgotten by enemies', () => {
    const start = dying();
    const now = start.tick;
    const after = step(start, [attack(1, DUMMY)]); // at 0 health they don't act
    const player = characterOf(after, 1);
    expect(player.tile).toEqual(t(9, 4));
    expect(player.stepped).toEqual([]);
    expect(player.health).toBe(0);
    expect(player.respawnTick).toBe(now + 1);
    expect(player.order).toEqual({ kind: 'none' });
    expect(player.path).toEqual([]);
    expect(after.hits).toEqual([]);
    expect(after.recaps).toEqual([{ characterId: 1, tick: now, hits: start.characters[0]!.recentHits }]);
    expect(after.downed).toEqual([1]);
    expect(enemyOf(after, SLIME).lastDamagedBy).toBeNull();

    const respawned = step(after, []);
    const back = characterOf(respawned, 1);
    expect(back.tile).toEqual(respawned.spawn);
    expect(back.health).toBe(maxHealthOf(back.sheet, content));
    expect(back.respawnTick).toBeNull();
    expect(back.recentHits).toEqual([]);
    expect(back.order).toEqual({ kind: 'none' });
    expect(respawned.respawned).toEqual([1]);
    expect(respawned.downed).toEqual([]);
    expect(respawned.recaps).toEqual([]);
  });

  it('while down, attack and move intentions are ignored', () => {
    let start = practiceWith([t(9, 4)]);
    start = withCharacter(start, 1, { health: 0, respawnTick: start.tick + 3 });
    const after = step(start, [attack(1, DUMMY), move(1, t(9, 8))]);
    const player = characterOf(after, 1);
    expect(after.hits).toEqual([]);
    expect(player.order).toEqual({ kind: 'none' });
    expect(player.path).toEqual([]);
    expect(player.tile).toEqual(t(9, 4));
    expect(player.respawnTick).toBe(start.tick + 3);
    expect(after.downed).toEqual([]); // already down: no second recap
    expect(after.recaps).toEqual([]);
  });

  it('a respawning player takes the nearest free tile when the spawn is occupied', () => {
    let start = practiceWith([t(9, 4), t(12, 19)]);
    start = withCharacter(start, 1, { health: 0, respawnTick: start.tick });
    const after = step(start, []);
    const tile = characterOf(after, 1).tile;
    expect(tile).not.toEqual(t(12, 19));
    expect(nearness(tile, t(12, 19))).toBe(1);
    expect(after.respawned).toEqual([1]);
  });

  it('down players take up no tile: joins, waves and enemies may use it', () => {
    let start = practiceWith([t(12, 19)]);
    start = withCharacter(start, 1, { health: 0, respawnTick: start.tick + 10 });
    // A join lands on the spawn under the body.
    const joined = step(start, [{ kind: 'join', characterId: 2, subtick: 0 }]);
    expect(characterOf(joined, 2).tile).toEqual(t(12, 19));
    // A wave places the dummy on its own tile under a body.
    const onDummyTile = withCharacter(start, 1, { tile: t(8, 4) });
    expect(enemyOf(startWave(onDummyTile, 'practice'), 3).tile).toEqual(t(8, 4));
    // An enemy walks onto a body's tile.
    let walking = withCharacter(start, 1, { tile: t(14, 4) });
    walking = withEnemy(walking, SLIME, { path: [t(14, 4)], progress: 1000 });
    expect(enemyOf(step(walking, []), SLIME).tile).toEqual(t(14, 4));
  });

  it('RECAP_HITS is 5', () => {
    expect(RECAP_HITS).toBe(5);
  });
});

describe('attack-move (Task 4: stored, and walks to its destination)', () => {
  it('stores the order and walks there; the order ends on arrival', () => {
    const start = practiceWith([t(3, 18)]);
    const states = run(start, [[attackMove(1, t(5, 18))], ...quiet(5)]);
    expect(characterOf(states[0]!, 1).order).toEqual({ kind: 'attack-move', destination: t(5, 18), lockedOn: null });
    const final = characterOf(states[5]!, 1);
    expect(final.tile).toEqual(t(5, 18));
    expect(final.order).toEqual({ kind: 'none' });
  });

  it('builder call: an attack-move with no weapon is ignored', () => {
    const start = practiceWith([t(3, 18)]);
    const unarmed = step(start, [{ kind: 'debug-weapon', characterId: 1, itemId: null, subtick: 0 }]);
    const after = step(unarmed, [attackMove(1, t(5, 18))]);
    expect(characterOf(after, 1).order).toEqual({ kind: 'none' });
  });
});

describe('the training dummy', () => {
  it('with 900 health after a hit at tick h, it is back to full at h+20, not at h+19', () => {
    const healsAfter = content.enemies['training-dummy']!.healsAfterTicks!;
    let state: WorldState = { ...practiceWith([t(3, 18)]), tick: 100 };
    const h = 100 - (healsAfter - 1); // the next step processes tick h+19
    state = withEnemy(state, DUMMY, { health: 900, lastHitTick: h, lastDamagedBy: 1 });
    const at19 = step(state, []);
    expect(enemyOf(at19, DUMMY).health).toBe(900);
    expect(enemyOf(at19, DUMMY).lastHitTick).toBe(h);
    const at20 = step(at19, []);
    expect(at20.tick - 1 - h).toBe(healsAfter);
    expect(enemyOf(at20, DUMMY).health).toBe(1000);
    expect(enemyOf(at20, DUMMY).lastHitTick).toBeNull();
    expect(enemyOf(at20, DUMMY).tile).toEqual(t(8, 4));
  });

  it('a slime (no healsAfterTicks) never heals', () => {
    let state: WorldState = { ...practiceWith([t(3, 18)]), tick: 100 };
    state = withEnemy(state, SLIME, { health: 5, lastHitTick: 10 });
    expect(enemyOf(step(state, []), SLIME).health).toBe(5);
  });
});

describe('sanity', () => {
  it('the test tiles are what the tests assume', () => {
    const world = practiceWith([t(9, 4)]);
    expect(enemyOf(world, DUMMY).tile).toEqual(t(8, 4));
    expect(enemyOf(world, SLIME).tile).toEqual(t(15, 4));
    expect(sameTile(world.spawn, t(12, 19))).toBe(true);
  });
});
