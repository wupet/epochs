import { describe, expect, it } from 'vitest';
import {
  RECAP_HITS,
  createArenaWorld,
  attributesOf,
  canStrike,
  chooseEnemyOrders,
  computeDamage,
  inReach,
  maxHealthOf,
  nearness,
  rememberHit,
  rollSpread,
  sameTile,
  startWave,
  step,
} from './index';
import type { Hit, Intention, Tile, WorldState } from './index';
import {
  arenaWith,
  attack,
  attackMove,
  characterOf,
  content,
  enemyOf,
  move,
  quiet,
  run,
  t,
  withCharacter,
  withEnemy,
  withPreset,
  withoutEnemy,
} from './test-support/arena';

/** The practice wave's enemies: the dummy at (8,4), then the slime at (15,4). */
const DUMMY = 1;
const SLIME = 2;

/** The arena (seed 7) with the practice wave, then players 1..n placed on the given tiles. */
function practiceWith(tiles: readonly Tile[], seed = 7): WorldState {
  return arenaWith('practice', tiles, seed);
}

/** The practice wave without the slime, for tests that count every hit: a chasing slime would add its own. */
function dummyOnlyWith(tiles: readonly Tile[]): WorldState {
  return withoutEnemy(practiceWith(tiles), SLIME);
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

describe('basic attacks: melee', () => {
  it('a militia next to the dummy hits on ticks t, t+4 and t+8, each for the formula amount', () => {
    const start = dummyOnlyWith([t(9, 4)]);
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
    const running = step(dummyOnlyWith([t(9, 4)]), [{ kind: 'mode', characterId: 1, mode: 'run', subtick: 0 }]);
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
    // Speed 0: the slime idles (spec step 6), so it stays where the corner geometry needs it.
    let start = withEnemy(practiceWith([t(10, 11)]), SLIME, { tile: t(11, 12), speed: 0 });
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
    const start = dummyOnlyWith([t(9, 4)]);
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
    start = withEnemy(start, SLIME, { tile: t(18, 4), speed: 0 }); // speed 0: it idles, so the pillar stays between
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
    // Far from wave 1's slimes (9 tiles), so none of them reaches the player in the 5 ticks watched.
    const start = practiceWith([t(16, 12)]);
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

/** The slime's touch, from the content. */
const TOUCH = content.enemies.slime!.attacks[0]!;

/** The amount a slime's touch deals to a player, with the spread rolled from `rng`. */
function expectedTouch(before: WorldState, playerId: number, rng = before.rng) {
  const player = characterOf(before, playerId);
  const armor = content.items[player.sheet.armorId!]!.armor!;
  const spread = rollSpread(rng);
  const amount = computeDamage({
    damage: TOUCH.damage,
    attacker: null,
    spreadPercent: spread.percent,
    resistances: armor.resistances,
    armor: armor.armor,
  });
  return { amount, rng: spread.state };
}

/** The ticks on which an enemy's windups started (the tick processed, not the state's tick). */
function windupStarts(states: readonly WorldState[], enemyId: number): number[] {
  const starts: number[] = [];
  let before: WorldState | undefined;
  for (const s of states) {
    const windup = s.enemies.find((e) => e.id === enemyId)?.windup ?? null;
    const was = before?.enemies.find((e) => e.id === enemyId)?.windup ?? null;
    if (windup !== null && was === null) starts.push(s.tick - 1);
    before = s;
  }
  return starts;
}

function lockOf(state: WorldState, id: number): number | null {
  const { order } = characterOf(state, id);
  return order.kind === 'attack-move' ? order.lockedOn : null;
}

describe('slime touch', () => {
  it('the slime chases the nearest player', () => {
    const start = practiceWith([t(15, 12)]);
    const states = run(start, quiet(14));
    const distances = states.map((s) => nearness(enemyOf(s, SLIME).tile, t(15, 12)));
    expect(distances[distances.length - 1]).toBe(1);
    for (let i = 1; i < distances.length; i++) expect(distances[i]!).toBeLessThanOrEqual(distances[i - 1]!);
  });

  it('a touch winds up on tick T on the player tile and lands on T+1, with its telegraph', () => {
    const start = practiceWith([t(14, 4)]);
    const T = start.tick;
    const wound = step(start, []);
    expect(wound.hits).toEqual([]);
    expect(enemyOf(wound, SLIME).windup).toEqual({ attackId: 'touch', tiles: [t(14, 4)], resolvesAt: T + 1 });
    expect(wound.rng).toBe(start.rng); // starting a windup rolls nothing

    const landed = step(wound, []);
    const expected = expectedTouch(wound, 1);
    expect(expected.amount).toBe(2); // force 3 through the jerkin's armor 1
    const hit: Hit = {
      tick: T + 1,
      attacker: { side: 'enemy', id: SLIME },
      target: { side: 'player', id: 1 },
      amount: expected.amount,
      attackerName: 'Slime',
      attackName: 'Touch',
      telegraph: { name: 'Touch', windupTicks: 1 },
    };
    expect(landed.hits).toEqual([hit]);
    expect(landed.rng).toBe(expected.rng);
    const player = characterOf(landed, 1);
    expect(player.health).toBe(maxHealthOf(player.sheet, content) - 2);
    expect(player.recentHits).toEqual([hit]);
    const slime = enemyOf(landed, SLIME);
    expect(slime.windup).toBeNull();
    expect(slime.readyTick).toBe(T + 1 + TOUCH.cooldownTicks + 1);
  });

  it('an enemy winding up does not move, even when it now chases someone out of reach', () => {
    // Player 2, a hunter 5 tiles off, shoots the slime on tick T, after it chose player 1 and as it
    // winds up on them. On T+1 it chases player 2, but stands still until the touch lands.
    const start = withPreset(practiceWith([t(14, 4), t(15, 9)]), 2, 'hunter');
    const wound = step(start, [attack(2, SLIME)]);
    expect(enemyOf(wound, SLIME).windup?.tiles).toEqual([t(14, 4)]);
    expect(enemyOf(wound, SLIME).lastDamagedBy).toBe(2);
    expect(chooseEnemyOrders(wound)[1]).toEqual({ kind: 'chase', target: 2 });
    const landed = step(wound, []);
    expect(enemyOf(landed, SLIME).tile).toEqual(t(15, 4));
    expect(enemyOf(landed, SLIME).stepped).toEqual([]);
    expect(landed.hits.some((h) => h.attacker.side === 'enemy' && h.target.id === 1)).toBe(true);
  });

  it('a player who stepped off at T+1 takes nothing, and the windup still clears', () => {
    const start = practiceWith([t(14, 4)]);
    const T = start.tick;
    const wound = step(start, []);
    const dodged = step(wound, [move(1, t(12, 4))]);
    expect(characterOf(dodged, 1).tile).toEqual(t(13, 4));
    expect(dodged.hits).toEqual([]);
    expect(dodged.rng).toBe(wound.rng);
    expect(characterOf(dodged, 1).health).toBe(maxHealthOf(characterOf(dodged, 1).sheet, content));
    expect(enemyOf(dodged, SLIME).windup).toBeNull();
    expect(enemyOf(dodged, SLIME).readyTick).toBe(T + 5);
  });

  it('the next windup starts no earlier than T+5: touches start on T, T+5 and T+10', () => {
    const start = practiceWith([t(14, 4)]);
    const T = start.tick;
    const states = run(start, quiet(12));
    expect(windupStarts(states, SLIME)).toEqual([T, T + 5, T + 10]);
    expect(states.flatMap((s) => s.hits).map((h) => h.tick)).toEqual([T + 1, T + 6, T + 11]);
  });

  it(`a player keeps only the last ${RECAP_HITS} hits taken, newest last`, () => {
    const start = practiceWith([t(14, 4)]);
    const states = run(start, quiet(32));
    const taken = states.flatMap((s) => s.hits).filter((h) => h.target.side === 'player');
    expect(taken.length).toBeGreaterThan(RECAP_HITS);
    expect(characterOf(states[states.length - 1]!, 1).recentHits).toEqual(taken.slice(-RECAP_HITS));
  });

  it('rememberHit appends and keeps the last RECAP_HITS', () => {
    const hits = Array.from({ length: 7 }, (_, i): Hit => ({
      tick: i,
      attacker: { side: 'enemy', id: 1 },
      target: { side: 'player', id: 1 },
      amount: i,
      attackerName: 'Slime',
      attackName: 'Touch',
      telegraph: null,
    }));
    let recent: readonly Hit[] = [];
    for (const hit of hits) recent = rememberHit(recent, hit);
    expect(recent).toEqual(hits.slice(2));
  });

  it('hits in 9.1 roll in enemy id order, then for the players on the tile in id order', () => {
    // Players 1 and 2 share (5,20); slimes 1 and 2 (wave 1) both have a windup on it due now.
    let start = withoutEnemy(arenaWith('wave-1', [t(5, 20), t(5, 20)]), 3);
    const now = start.tick;
    start = withEnemy(start, 1, { tile: t(4, 20), windup: { attackId: 'touch', tiles: [t(5, 20)], resolvesAt: now } });
    start = withEnemy(start, 2, { tile: t(6, 20), windup: { attackId: 'touch', tiles: [t(5, 20)], resolvesAt: now } });
    const after = step(start, []);
    expect(after.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ]);
    let rng = start.rng;
    for (const [i, hit] of after.hits.entries()) {
      const expected = expectedTouch(start, i % 2 === 0 ? 1 : 2, rng);
      expect(hit.amount).toBe(expected.amount);
      rng = expected.rng;
    }
    expect(after.rng).toBe(rng);
  });
});

describe('dying under a windup (Review Focus 4)', () => {
  /** Player 1 at 1 health on (5,20); slime 1 (wave 1) touches them now; slime 2 stands ready beside them. */
  function underTwoSlimes(): WorldState {
    let state = withoutEnemy(arenaWith('wave-1', [t(5, 20)]), 3);
    const now = state.tick;
    state = withCharacter(state, 1, { health: 1 });
    state = withEnemy(state, 1, { tile: t(4, 20), windup: { attackId: 'touch', tiles: [t(5, 20)], resolvesAt: now } });
    return withEnemy(state, 2, { tile: t(6, 20), readyTick: now });
  }

  it('the touch downs them; the second slime starts no windup on them; they respawn untouched', () => {
    const start = underTwoSlimes();
    const T = start.tick;
    const died = step(start, []);
    expect(died.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([[1, 1]]);
    expect(died.downed).toEqual([1]);
    expect(died.recaps).toEqual([{ characterId: 1, tick: T, hits: [died.hits[0]] }]);
    expect(characterOf(died, 1).tile).toEqual(t(5, 20));
    expect(characterOf(died, 1).respawnTick).toBe(T + 1);
    // Slime 2 chose its target before the death, but a player at 0 health can't be wound up on.
    expect(enemyOf(died, 2).windup).toBeNull();
    expect(enemyOf(died, 2).readyTick).toBe(T);

    const after = step(died, []);
    expect(after.respawned).toEqual([1]);
    const back = characterOf(after, 1);
    expect(back.tile).toEqual(after.spawn);
    expect(back.health).toBe(maxHealthOf(back.sheet, content));
    expect(after.hits).toEqual([]);
    expect(after.rng).toBe(died.rng);
    expect(enemyOf(after, 2).windup).toBeNull();
  });

  it('no windup starts on a player knocked to 0 this tick, even one standing on the spawn tile they respawn on', () => {
    let start = withoutEnemy(arenaWith('wave-1', [t(5, 20)]), 3);
    const spawn = start.spawn;
    const T = start.tick;
    // Slime 1 touches the player (1 health) on the spawn tile now; slime 2, ready, stands beside them.
    start = withCharacter(start, 1, { health: 1, tile: spawn });
    start = withEnemy(start, 1, {
      tile: t(spawn.x - 1, spawn.y),
      windup: { attackId: 'touch', tiles: [spawn], resolvesAt: T },
    });
    start = withEnemy(start, 2, { tile: t(spawn.x + 1, spawn.y), readyTick: T });
    const died = step(start, []);
    expect(died.downed).toEqual([1]);
    expect(died.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([[1, 1]]);
    expect(enemyOf(died, 2).windup).toBeNull();
    expect(windupStarts([start, died], 2)).toEqual([]);

    const after = step(died, []);
    expect(after.respawned).toEqual([1]);
    expect(characterOf(after, 1).tile).toEqual(spawn);
    expect(after.hits).toEqual([]);
    expect(after.rng).toBe(died.rng);
    expect(characterOf(after, 1).health).toBe(maxHealthOf(characterOf(after, 1).sheet, content));
  });

  it('a player who is down is never hit by a resolving windup, even standing on its tile', () => {
    let start = underTwoSlimes();
    start = withCharacter(start, 1, { health: 0, respawnTick: start.tick + 5 });
    const after = step(start, []);
    expect(after.hits).toEqual([]);
    expect(after.rng).toBe(start.rng);
    expect(characterOf(after, 1).health).toBe(0);
    expect(characterOf(after, 1).recentHits).toEqual([]);
    expect(enemyOf(after, 1).windup).toBeNull();
    // Nobody to chase: slime 2 starts nothing.
    expect(enemyOf(after, 2).windup).toBeNull();
  });
});

describe('attack-move locking', () => {
  it('walking past the slime: locks on while it is in reach, attacks it, and walks on once it dies', () => {
    const start = withoutEnemy(withEnemy(practiceWith([t(11, 8)]), SLIME, { tile: t(15, 8) }), DUMMY);
    const states = run(start, [[attackMove(1, t(20, 8))], ...quiet(60)]);
    const lockedAt = states.findIndex((s) => lockOf(s, 1) === SLIME);
    expect(lockedAt).toBeGreaterThan(0);
    expect(states.slice(0, lockedAt).some((s) => characterOf(s, 1).stepped.length > 0)).toBe(true);
    const deadAt = states.findIndex((s) => !s.enemies.some((e) => e.id === SLIME));
    expect(deadAt).toBeGreaterThan(lockedAt);
    // While locked, the player stands still; every hit they land is on the slime.
    for (const s of states.slice(lockedAt, deadAt + 1)) {
      expect(lockOf(s, 1)).toBe(SLIME);
      expect(characterOf(s, 1).stepped).toEqual([]);
    }
    const dealt = states.flatMap((s) => s.hits).filter((h) => h.attacker.side === 'player');
    expect(dealt.length).toBeGreaterThan(0);
    for (const h of dealt) expect(h.target).toEqual({ side: 'enemy', id: SLIME });
    // Once it's gone, the lock clears and the walk resumes to the destination.
    expect(lockOf(states[deadAt + 1]!, 1)).toBeNull();
    expect(states.slice(deadAt + 1).some((s) => characterOf(s, 1).stepped.length > 0)).toBe(true);
    const final = characterOf(states[states.length - 1]!, 1);
    expect(final.tile).toEqual(t(20, 8));
    expect(final.order).toEqual({ kind: 'none' });
  });

  it('with the dummy and the slime both in reach, it locks onto the nearer one', () => {
    const start = withPreset(practiceWith([t(12, 4)]), 1, 'hunter');
    expect(inReach(start.grid, t(12, 4), t(8, 4), 6) && inReach(start.grid, t(12, 4), t(15, 4), 6)).toBe(true);
    expect(nearness(t(12, 4), t(15, 4))).toBeLessThan(nearness(t(12, 4), t(8, 4)));
    const after = step(start, [attackMove(1, t(12, 12))]);
    expect(lockOf(after, 1)).toBe(SLIME);
    expect(after.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([[1, SLIME]]);
  });

  it('ties go to the lower id', () => {
    const start = withPreset(practiceWith([t(11, 8)]), 1, 'hunter');
    expect(inReach(start.grid, t(11, 8), t(8, 4), 6) && inReach(start.grid, t(11, 8), t(15, 4), 6)).toBe(true);
    expect(nearness(t(11, 8), t(8, 4))).toBe(nearness(t(11, 8), t(15, 4)));
    const after = step(start, [attackMove(1, t(11, 16))]);
    expect(lockOf(after, 1)).toBe(DUMMY);
    expect(after.hits.map((h) => [h.attacker.id, h.target.id])).toEqual([[1, DUMMY]]);
  });

  it('a locked slime that leaves reach is dropped, and walking resumes', () => {
    // The slime last took damage from player 2, far to the east, so it walks away from player 1.
    let start = withoutEnemy(practiceWith([t(10, 18), t(20, 18)]), DUMMY);
    start = withEnemy(start, SLIME, { tile: t(11, 18), lastDamagedBy: 2 });
    const states = run(start, [[attackMove(1, t(3, 18))], ...quiet(20)]);
    expect(lockOf(states[0]!, 1)).toBe(SLIME);
    expect(characterOf(states[0]!, 1).stepped).toEqual([]);
    expect(enemyOf(states[0]!, SLIME).tile).toEqual(t(12, 18)); // out of reach before the attacks
    expect(states[0]!.hits).toEqual([]);
    expect(lockOf(states[1]!, 1)).toBeNull();
    expect(characterOf(states[1]!, 1).stepped).toEqual([t(9, 18)]);
    const byPlayer1 = states.flatMap((s) => s.hits).filter((h) => h.attacker.side === 'player' && h.attacker.id === 1);
    expect(byPlayer1).toEqual([]);
    const final = characterOf(states[states.length - 1]!, 1);
    expect(final.tile).toEqual(t(3, 18));
    expect(final.order).toEqual({ kind: 'none' });
  });

  it('builder call: an attack-move ends if the weapon is removed', () => {
    const start = practiceWith([t(3, 18)]);
    const walking = step(start, [attackMove(1, t(9, 18))]);
    expect(characterOf(walking, 1).order.kind).toBe('attack-move');
    const after = step(walking, [{ kind: 'debug-weapon', characterId: 1, itemId: null, subtick: 0 }]);
    expect(characterOf(after, 1).order).toEqual({ kind: 'none' });
    expect(characterOf(after, 1).path).toEqual([]);
  });
});

describe('crowding (Review Focus 5)', () => {
  /** Three players attack-moving up and down the arena through wave 1, which restarts whenever it is cleared. */
  function crowdedFight(seed: number): WorldState[] {
    let world = createArenaWorld(content, 'arena', seed);
    const columns = [4, 12, 20];
    const states: WorldState[] = [];
    for (let i = 0; i < 300; i++) {
      const intentions: Intention[] = [];
      if (i === 0) {
        for (const id of [1, 2, 3]) intentions.push({ kind: 'join', characterId: id, subtick: 0 });
      } else if (i === 1) {
        intentions.push({ kind: 'debug-preset', characterId: 2, presetId: 'hunter', subtick: 0 });
        intentions.push({ kind: 'debug-preset', characterId: 3, presetId: 'hedge-witch', subtick: 0 });
        intentions.push({ kind: 'debug-start-wave', characterId: 1, waveId: 'wave-1', subtick: 0 });
      } else {
        if (i % 50 === 2) {
          const y = (i - 2) % 100 === 0 ? 2 : 21;
          columns.forEach((x, k) => intentions.push(attackMove(k + 1, t(x, y))));
        }
        if (world.enemies.length === 0) {
          intentions.push({ kind: 'debug-start-wave', characterId: 1, waveId: 'wave-1', subtick: 0 });
        }
      }
      world = step(world, intentions);
      states.push(world);
    }
    return states;
  }

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: after every tick, no enemy shares a tile with an enemy or a player who isn't down`, () => {
      const states = crowdedFight(seed);
      for (const s of states) {
        const standing = s.characters.filter((c) => c.respawnTick === null);
        for (const enemy of s.enemies) {
          for (const c of standing) expect(sameTile(enemy.tile, c.tile), `tick ${s.tick}`).toBe(false);
          for (const other of s.enemies) {
            if (other.id !== enemy.id) expect(sameTile(enemy.tile, other.tile), `tick ${s.tick}`).toBe(false);
          }
        }
      }
      // Not vacuous: slimes touched players, players hit slimes, and two or more crowded one player at once.
      const hits = states.flatMap((s) => s.hits);
      expect(hits.some((h) => h.attacker.side === 'enemy')).toBe(true);
      expect(hits.some((h) => h.attacker.side === 'player')).toBe(true);
      expect(
        states.some((s) =>
          s.characters.some((c) => s.enemies.filter((e) => nearness(e.tile, c.tile) === 1).length >= 2),
        ),
      ).toBe(true);
    });
  }
});
