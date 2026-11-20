import { describe, expect, it } from 'vitest';
import {
  DEBUG_MOVEMENT_MODES,
  DEFAULT_SPEED,
  EMPTY_CONTENT,
  MAX_SPEED,
  MAX_STEPS_PER_TICK,
  STEP,
  attributesOf,
  createArenaWorld,
  createWorld,
  findSpawnTile,
  gridFromRows,
  isDebugMovementMode,
  maxHealthOf,
  newSheet,
  sameTile,
  step,
} from './index';
import type { Character, DebugMovementMode, Grid, Intention, Tile, WorldState } from './index';
import { realContent } from './test-support/real-content';

function open(width: number, height: number): Grid {
  return gridFromRows(Array.from({ length: height }, () => '.'.repeat(width)));
}

function t(x: number, y: number): Tile {
  return { x, y };
}

function join(characterId: number, subtick = 0): Intention {
  return { kind: 'join', characterId, subtick };
}

function leave(characterId: number, subtick = 0): Intention {
  return { kind: 'leave', characterId, subtick };
}

function move(characterId: number, target: Tile, subtick = 0): Intention {
  return { kind: 'move', characterId, target, subtick };
}

function mode(characterId: number, value: DebugMovementMode, subtick = 0): Intention {
  return { kind: 'mode', characterId, mode: value, subtick };
}

/**
 * A character as a fresh join in an empty-content world would have it, with the given walking fields:
 * no preset, full health, no order. For literal `Character`s in tests.
 */
function newCharacter(walking: Pick<Character, 'id' | 'tile' | 'path' | 'speed' | 'progress' | 'stepped'>): Character {
  const sheet = newSheet(EMPTY_CONTENT, null);
  return {
    ...walking,
    health: maxHealthOf(sheet, EMPTY_CONTENT),
    sheet,
    order: { kind: 'none' },
    nextAttackTick: 0,
    recentHits: [],
  };
}

function tileOf(state: WorldState, id: number): Tile {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character.tile;
}

function pathOf(state: WorldState, id: number): readonly Tile[] {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character.path;
}

/** A 9x9 open world with spawn (4,4) and character 1 already standing there. */
function worldWithOne(): WorldState {
  return step(createWorld(open(9, 9), t(4, 4)), [join(1)]);
}

describe('createWorld', () => {
  it('starts at tick 0 with no characters', () => {
    const world = createWorld(open(5, 5), t(2, 2));
    expect(world.tick).toBe(0);
    expect(world.characters).toEqual([]);
    expect(world.spawn).toEqual(t(2, 2));
  });

  it('throws when the spawn is not walkable', () => {
    const grid = gridFromRows(['.#.', '...']);
    expect(() => createWorld(grid, t(1, 0))).toThrow();
    expect(() => createWorld(grid, t(5, 5))).toThrow();
  });
});

describe('findSpawnTile', () => {
  it('returns the spawn when it is free', () => {
    expect(findSpawnTile(createWorld(open(5, 5), t(2, 2)))).toEqual(t(2, 2));
  });

  it('returns a free tile next to the spawn when the spawn is taken', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(1)]);
    expect(findSpawnTile(world)).toEqual(t(2, 1));
  });

  it('falls back to the spawn when every reachable tile is taken', () => {
    const world = step(createWorld(open(1, 1), t(0, 0)), [join(1)]);
    expect(findSpawnTile(world)).toEqual(t(0, 0));
  });
});

describe('step: joining and leaving', () => {
  it('a join adds a character at the spawn and the tick goes to 1', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(1)]);
    expect(world.tick).toBe(1);
    expect(world.characters).toEqual([
      newCharacter({ id: 1, tile: t(2, 2), path: [], speed: DEFAULT_SPEED, progress: STEP, stepped: [] }),
    ]);
  });

  it('two joins in one tick land on different tiles, the second next to the spawn', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(1), join(2)]);
    expect(tileOf(world, 1)).toEqual(t(2, 2));
    const second = tileOf(world, 2);
    expect(sameTile(second, t(2, 2))).toBe(false);
    expect(Math.abs(second.x - 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(second.y - 2)).toBeLessThanOrEqual(1);
  });

  it('a second join on a later tick lands on a different free tile', () => {
    const world = step(worldWithOne(), [join(2)]);
    expect(sameTile(tileOf(world, 1), tileOf(world, 2))).toBe(false);
  });

  it('joins in one tick are applied in (subtick, id) order', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(1, 5), join(2, 0)]);
    expect(tileOf(world, 2)).toEqual(t(2, 2));
    expect(sameTile(tileOf(world, 1), t(2, 2))).toBe(false);
  });

  it('a join of an existing id is ignored', () => {
    const before = worldWithOne();
    const after = step(before, [join(1)]);
    expect(after.characters).toEqual(before.characters);
  });

  it('a leave removes the character', () => {
    const world = step(worldWithOne(), [leave(1)]);
    expect(world.characters).toEqual([]);
    expect(world.tick).toBe(2);
  });

  it('a leave of an unknown id is ignored', () => {
    const before = worldWithOne();
    const after = step(before, [leave(99)]);
    expect(after.characters).toEqual(before.characters);
  });

  it('a move for a character that joins in the same tick is honoured', () => {
    const world = step(createWorld(open(9, 9), t(4, 4)), [move(1, t(8, 4)), join(1)]);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
  });

  it('a move for an unknown id is ignored', () => {
    const before = worldWithOne();
    const after = step(before, [move(99, t(0, 0))]);
    expect(after.characters).toEqual(before.characters);
  });

  it('a move for a character that leaves in the same tick is ignored', () => {
    const world = step(worldWithOne(), [move(1, t(8, 4)), leave(1)]);
    expect(world.characters).toEqual([]);
  });
});

describe('step: moving', () => {
  it('walks one tile every 2 ticks (the first on the next tick) and arrives after 3 steps', () => {
    let world = worldWithOne();
    world = step(world, [move(1, t(7, 4))]);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
    expect(pathOf(world, 1)).toEqual([t(6, 4), t(7, 4)]);
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(6, 4));
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(6, 4));
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(7, 4));
    expect(pathOf(world, 1)).toEqual([]);
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(7, 4));
  });

  it('a new move mid-walk replaces the path on the next tick and turns on the next step', () => {
    let world = worldWithOne();
    world = step(world, [move(1, t(8, 4))]); // tick 1: now at (5,4)
    world = step(world, []); // tick 2: no step
    world = step(world, []); // tick 3: now at (6,4)
    expect(tileOf(world, 1)).toEqual(t(6, 4));
    world = step(world, [move(1, t(6, 8))]); // tick 4: re-routed, but this is a rest tick
    expect(tileOf(world, 1)).toEqual(t(6, 4));
    expect(pathOf(world, 1)).toEqual([t(6, 5), t(6, 6), t(6, 7), t(6, 8)]);
    world = step(world, []); // tick 5: the next step heads to the new target
    expect(tileOf(world, 1)).toEqual(t(6, 5));
    expect(pathOf(world, 1)).toEqual([t(6, 6), t(6, 7), t(6, 8)]);
  });

  it('with several moves for one character in one tick, only the last counts', () => {
    const world = step(worldWithOne(), [move(1, t(0, 4)), move(1, t(4, 0)), move(1, t(8, 4))]);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
  });

  it('the last move in (subtick, id) order wins, and ties go to the later one in the input', () => {
    const bySubtick = step(worldWithOne(), [move(1, t(8, 4), 9), move(1, t(0, 4), 3)]);
    expect(tileOf(bySubtick, 1)).toEqual(t(5, 4));
    const tie = step(worldWithOne(), [move(1, t(0, 4), 3), move(1, t(8, 4), 3)]);
    expect(tileOf(tie, 1)).toEqual(t(5, 4));
  });

  it('moving to your own tile leaves the character put with an empty path', () => {
    const world = step(worldWithOne(), [move(1, t(4, 4))]);
    expect(tileOf(world, 1)).toEqual(t(4, 4));
    expect(pathOf(world, 1)).toEqual([]);
  });

  it('two characters can be sent to the same tile and both end up there', () => {
    let world = step(createWorld(open(9, 9), t(4, 4)), [join(1), join(2)]);
    world = step(world, [move(1, t(8, 8)), move(2, t(8, 8))]);
    for (let i = 0; i < 20; i++) world = step(world, []); // 5 tiles at 2 ticks each, with room to spare
    expect(tileOf(world, 1)).toEqual(t(8, 8));
    expect(tileOf(world, 2)).toEqual(t(8, 8));
  });

  it('a diagonal step takes the same time as any other step', () => {
    let world = step(createWorld(open(6, 6), t(2, 2)), [join(1)]);
    world = step(world, [move(1, t(3, 3))]);
    expect(tileOf(world, 1)).toEqual(t(3, 3)); // rested: the diagonal is taken on the next tick
    expect(pathOf(world, 1)).toEqual([]);

    world = step(createWorld(open(6, 6), t(2, 2)), [join(1)]);
    world = step(world, [move(1, t(5, 5))]);
    expect(tileOf(world, 1)).toEqual(t(3, 3));
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(3, 3)); // the next diagonal takes 2 ticks, like an orthogonal step
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(4, 4));
  });

  it('a move intention with subtick 0 is honoured', () => {
    const world = step(worldWithOne(), [move(1, t(8, 4), 0)]);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
  });

  it('a move to a blocked tile walks to the nearest reachable tile', () => {
    const grid = gridFromRows(['.....', '.....', '..#..']);
    let world = step(createWorld(grid, t(0, 0)), [join(1)]);
    world = step(world, [move(1, t(2, 2))]);
    for (let i = 0; i < 6; i++) world = step(world, []);
    // From (0,0), (1,1) is nearness 1 from (2,2) and 1 step away; (2,1) is also nearness 1 but 2 steps away.
    expect(tileOf(world, 1)).toEqual(t(1, 1));
  });

  it('clears the path when the next step is no longer allowed', () => {
    const grid = gridFromRows(['...']);
    const base = step(createWorld(grid, t(0, 0)), [join(1)]);
    const stale: WorldState = {
      ...base,
      characters: [
        newCharacter({ id: 1, tile: t(0, 0), path: [t(2, 0)], speed: DEFAULT_SPEED, progress: STEP, stepped: [] }),
      ],
    };
    const after = step(stale, []);
    expect(tileOf(after, 1)).toEqual(t(0, 0));
    expect(pathOf(after, 1)).toEqual([]);
  });
});

describe('step: purity and shape', () => {
  it('leaves the input state and intentions unchanged', () => {
    const before = step(createWorld(open(9, 9), t(4, 4)), [join(1), join(2), move(1, t(8, 8))]);
    const snapshot = structuredClone(before);
    const intentions: Intention[] = [move(2, t(0, 0)), join(3), leave(1)];
    const intentionsSnapshot = structuredClone(intentions);
    step(before, intentions);
    expect(before).toEqual(snapshot);
    expect(intentions).toEqual(intentionsSnapshot);
  });

  it('keeps characters sorted by id', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(3), join(1, 4), join(2, 2)]);
    expect(world.characters.map((c) => c.id)).toEqual([1, 2, 3]);
    const later = step(world, [leave(2), join(5)]);
    expect(later.characters.map((c) => c.id)).toEqual([1, 3, 5]);
  });
});

// --- Movement speed ----------------------------------------------------------------------------

/** A 12x12 open world with spawn (1,5) and character 1 already standing there, rested and walking. */
function movementWorld(): WorldState {
  return step(createWorld(open(12, 12), t(1, 5)), [join(1)]);
}

/** A copy of the state with every character's speed set directly (no debug mode gives 750). */
function withSpeed(state: WorldState, speed: number): WorldState {
  return { ...state, characters: state.characters.map((c) => ({ ...c, speed })) };
}

function characterOf(state: WorldState, id: number) {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character;
}

/**
 * Steps the world once per entry of `perTick` (the intentions for that tick). Returns the 1-based
 * numbers of the ticks on which character 1's tile changed, and its `stepped` after each tick.
 */
function stepTicks(
  start: WorldState,
  perTick: readonly (readonly Intention[])[],
): { ticks: number[]; stepped: (readonly Tile[])[]; end: WorldState } {
  const ticks: number[] = [];
  const stepped: (readonly Tile[])[] = [];
  let world = start;
  perTick.forEach((intentions, index) => {
    const before = tileOf(world, 1);
    world = step(world, intentions);
    if (!sameTile(before, tileOf(world, 1))) ticks.push(index + 1);
    stepped.push(characterOf(world, 1).stepped);
  });
  return { ticks, stepped, end: world };
}

const idle = (count: number): Intention[][] => Array.from({ length: count }, () => []);

describe('movement constants and debug modes', () => {
  it('has the documented values', () => {
    expect(STEP).toBe(1000);
    expect(MAX_STEPS_PER_TICK).toBe(2);
    expect(MAX_SPEED).toBe(2000);
    expect(DEBUG_MOVEMENT_MODES).toEqual({ walk: 500, run: 1000, horse: 2000 });
    expect(DEFAULT_SPEED).toBe(500);
  });

  it('accepts only the own debug mode names', () => {
    for (const name of ['walk', 'run', 'horse']) expect(isDebugMovementMode(name)).toBe(true);
    const bad = ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'Walk', '', 'gallop', 1, null, undefined, {}];
    for (const value of bad) expect(isDebugMovementMode(value)).toBe(false);
  });
});

describe('step: movement speed', () => {
  it('a rested walker steps on ticks 1, 3, 5 and 7', () => {
    const { ticks, end } = stepTicks(movementWorld(), [[move(1, t(5, 5))], ...idle(9)]);
    expect(ticks).toEqual([1, 3, 5, 7]);
    expect(tileOf(end, 1)).toEqual(t(5, 5));
  });

  it('a runner (a debug mode set in the same tick as the move) steps on ticks 1, 2, 3 and 4', () => {
    const { ticks, end } = stepTicks(movementWorld(), [[mode(1, 'run'), move(1, t(5, 5))], ...idle(6)]);
    expect(ticks).toEqual([1, 2, 3, 4]);
    expect(tileOf(end, 1)).toEqual(t(5, 5));
  });

  it('a rested rider sets off at full pace: 2 tiles on the first tick, and records the tiles entered in order', () => {
    // Switch to horse and rest one tick, so the horse's rest cap (one tick's worth, 2000) is banked.
    let world = step(movementWorld(), [mode(1, 'horse')]);
    expect(characterOf(world, 1).progress).toBe(MAX_SPEED);
    const { stepped, end } = stepTicks(world, [[move(1, t(7, 5))], ...idle(3)]);
    expect(stepped.map((s) => s.length)).toEqual([2, 2, 2, 0]);
    expect(stepped[0]).toEqual([t(2, 5), t(3, 5)]);
    expect(stepped[1]).toEqual([t(4, 5), t(5, 5)]);
    expect(stepped[2]).toEqual([t(6, 5), t(7, 5)]);
    expect(tileOf(end, 1)).toEqual(t(7, 5));
  });

  it('a rested rider sets off at full pace', () => {
    // From (1,5) on open ground: horse speed 2000, rest cap max(STEP, 2000) = 2000.
    const rested = step(movementWorld(), [mode(1, 'horse')]);
    const { stepped } = stepTicks(rested, [[move(1, t(11, 5))], ...idle(4)]);
    expect(stepped.map((s) => s.length)).toEqual([2, 2, 2, 2, 2]); // 10 tiles in 5 ticks, 2 on the very first
    // A rested runner and a rested walker: no change from before.
    const runner = step(movementWorld(), [mode(1, 'run')]);
    expect(stepTicks(runner, [[move(1, t(5, 5))], ...idle(3)]).ticks).toEqual([1, 2, 3, 4]);
    expect(stepTicks(movementWorld(), [[move(1, t(5, 5))], ...idle(6)]).ticks).toEqual([1, 3, 5, 7]);
  });

  it('after resting, a horse switched to walk banks only one step', () => {
    let world = step(movementWorld(), [mode(1, 'horse')]);
    for (let i = 0; i < 3; i++) world = step(world, []);
    expect(characterOf(world, 1).progress).toBe(MAX_SPEED); // a horse at rest holds one tick's worth
    world = step(world, [mode(1, 'walk')]); // still idle: capped by the walk cap
    expect(characterOf(world, 1).progress).toBeLessThanOrEqual(STEP);
    const { ticks } = stepTicks(world, [[move(1, t(5, 5))], ...idle(6)]);
    expect(ticks).toEqual([1, 3, 5, 7]); // steps on ticks 1, 3, 5 of a new walk
  });

  it('a character with speed 750 steps on ticks 1, 3, 4, 5, 7 and 8', () => {
    const start = withSpeed(movementWorld(), 750);
    const { ticks } = stepTicks(start, [[move(1, t(11, 5))], ...idle(7)]);
    expect(ticks).toEqual([1, 3, 4, 5, 7, 8]); // 6 steps = 1 + floor(7 * 750 / 1000)
  });

  it('never steps more than MAX_STEPS_PER_TICK in one tick, however long the path', () => {
    const start = withSpeed(movementWorld(), MAX_SPEED);
    const { stepped } = stepTicks(start, [[move(1, t(11, 11))], ...idle(8)]);
    expect(Math.max(...stepped.map((s) => s.length))).toBe(MAX_STEPS_PER_TICK);
  });

  it('records the tile entered on a single step, and clears stepped on a standing tick', () => {
    let world = step(movementWorld(), [move(1, t(2, 5))]);
    expect(characterOf(world, 1).stepped).toEqual([t(2, 5)]);
    world = step(world, []);
    expect(characterOf(world, 1).stepped).toEqual([]);
  });

  /** Millitiles a standing character may hold: one tick's worth at its speed, never less than one step. */
  const restCap = (speed: number): number => Math.max(STEP, speed);
  const SPEEDS = [
    ['walk', DEBUG_MOVEMENT_MODES.walk],
    ['run', DEBUG_MOVEMENT_MODES.run],
    ['horse', DEBUG_MOVEMENT_MODES.horse],
  ] as const;

  /**
   * Spam-clicks for `ticks` ticks. `targetFor(tick, tile)` gives the move sent that tick. The
   * character starts on `start`, rested at this speed. Returns how many ticks changed its tile, the
   * most tiles stepped in one tick, the total tiles moved, and whether two consecutive ticks both
   * changed it.
   */
  function spam(
    speed: number,
    start: Tile,
    ticks: number,
    targetFor: (tick: number, tile: Tile) => Tile,
  ) {
    const base = withSpeed(movementWorld(), speed);
    let world: WorldState = {
      ...base,
      characters: [{ ...characterOf(base, 1), tile: start, progress: restCap(speed) }],
    };
    let changedTicks = 0;
    let mostStepped = 0;
    let total = 0;
    let consecutive = false;
    let previousChanged = false;
    for (let i = 0; i < ticks; i++) {
      const before = tileOf(world, 1);
      world = step(world, [move(1, targetFor(i, before))]);
      const changed = !sameTile(before, tileOf(world, 1));
      if (changed) changedTicks++;
      if (changed && previousChanged) consecutive = true;
      previousChanged = changed;
      const count = characterOf(world, 1).stepped.length;
      mostStepped = Math.max(mostStepped, count);
      total += count;
    }
    return { changedTicks, mostStepped, total, consecutive };
  }

  // (a) every tick, click whichever of two adjacent tiles you are not on.
  const adjacent = (_tick: number, tile: Tile): Tile => (sameTile(tile, t(5, 5)) ? t(6, 5) : t(5, 5));
  // (b) alternate each tick between two tiles 6 apart in a straight line, wherever you are.
  const sixApart = (tick: number): Tile => (tick % 2 === 0 ? t(9, 5) : t(3, 5));

  it.each(SPEEDS)('spam-clicking at %s never beats the pace, on two adjacent tiles', (_name, speed) => {
    const { mostStepped, total, consecutive, changedTicks } = spam(speed, t(5, 5), 40, adjacent);
    expect(mostStepped).toBeLessThanOrEqual(MAX_STEPS_PER_TICK);
    expect(total).toBeLessThanOrEqual((restCap(speed) + 40 * speed) / STEP);
    if (speed === DEBUG_MOVEMENT_MODES.walk) expect(consecutive).toBe(false);
    // Hand-traced: each re-route is a one-tile path, so at most one step per tick.
    // Walk: progress 1000 steps on ticks 1, 3, ... 39 (a step leaves 0, +500 each tick): 20 steps.
    // Run: 1000 steps, leaves 0, +1000 back to 1000: a step every tick, 40.
    // Horse: 2000 steps once (path is one tile), leaves 1000, +2000, capped back to 2000: 40.
    const expected = speed === DEBUG_MOVEMENT_MODES.walk ? 20 : 40;
    expect(changedTicks).toBe(expected);
    expect(total).toBe(expected);
  });

  it.each(SPEEDS)('spam-clicking at %s never beats the pace, between two tiles 6 apart', (_name, speed) => {
    const { mostStepped, total, consecutive } = spam(speed, t(3, 5), 40, sixApart);
    expect(mostStepped).toBeLessThanOrEqual(MAX_STEPS_PER_TICK);
    expect(total).toBeLessThanOrEqual((restCap(speed) + 40 * speed) / STEP);
    if (speed === DEBUG_MOVEMENT_MODES.walk) expect(consecutive).toBe(false);
  });

  it('a re-route on the tick after a step does not step that tick, and steps on the one after', () => {
    let world = step(movementWorld(), [move(1, t(8, 5))]); // tick 1: steps
    expect(tileOf(world, 1)).toEqual(t(2, 5));
    world = step(world, [move(1, t(2, 9))]); // tick 2: re-routed, no step
    expect(tileOf(world, 1)).toEqual(t(2, 5));
    world = step(world, []); // tick 3: steps toward the new target
    expect(tileOf(world, 1)).toEqual(t(2, 6));
  });

  it('resting caps progress at one tick of movement at the current speed, never less than one step', () => {
    const expected = new Map([[DEFAULT_SPEED, STEP], [750, STEP], [DEBUG_MOVEMENT_MODES.run, STEP], [MAX_SPEED, MAX_SPEED]]);
    for (const [speed, cap] of expected) {
      let world = withSpeed(movementWorld(), speed);
      for (let i = 0; i < 10; i++) world = step(world, []);
      expect(characterOf(world, 1).progress).toBe(cap);
    }
  });

  it('progress built up while walking carries over a re-route', () => {
    let world = step(movementWorld(), [move(1, t(8, 5))]); // steps; progress 0, then +500
    expect(characterOf(world, 1).progress).toBe(500);
    world = step(world, [move(1, t(2, 9))]);
    expect(characterOf(world, 1).progress).toBe(1000);
  });

  it('a blocked next tile clears the path and still caps progress', () => {
    const base = movementWorld();
    const stale: WorldState = {
      ...base,
      characters: [{ ...characterOf(base, 1), path: [t(9, 9)], progress: STEP }],
    };
    const after = step(stale, []);
    expect(characterOf(after, 1).path).toEqual([]);
    expect(characterOf(after, 1).progress).toBe(STEP);
  });
});

describe('step: debug mode changes', () => {
  it('changes speed and keeps progress', () => {
    const walking = step(movementWorld(), [move(1, t(8, 5))]); // stepped once; progress is 500
    expect(characterOf(walking, 1).progress).toBe(500);
    // No step this tick (500 < STEP); the carried-over 500 is topped up at the new speed.
    const after = step(walking, [mode(1, 'run')]);
    expect(characterOf(after, 1).speed).toBe(DEBUG_MOVEMENT_MODES.run);
    expect(characterOf(after, 1).progress).toBe(500 + DEBUG_MOVEMENT_MODES.run);
    expect(characterOf(after, 1).stepped).toEqual([]);
  });

  it('is ignored for an unknown id', () => {
    const before = movementWorld();
    const after = step(before, [mode(99, 'run')]);
    expect(after.characters).toEqual(before.characters);
  });

  it('is ignored when the mode is not a real debug mode', () => {
    const before = movementWorld();
    const bogus = { kind: 'mode', characterId: 1, mode: 'toString', subtick: 0 } as unknown as Intention;
    const after = step(before, [bogus]);
    expect(characterOf(after, 1).speed).toBe(DEFAULT_SPEED);
  });

  it('the last mode in (subtick, id) order wins, and one for a character joining this tick is honoured', () => {
    const world = step(createWorld(open(12, 12), t(1, 5)), [mode(1, 'run', 3), mode(1, 'horse', 1), join(1)]);
    expect(characterOf(world, 1).speed).toBe(DEBUG_MOVEMENT_MODES.run);
  });
});

// --- Arena worlds, sheets and debug intentions -----------------------------------------------------

const content = realContent();

/** The arena with player 1 joined (at the spawn, as a militia). */
function arenaWithOne(): WorldState {
  return step(createArenaWorld(content, 'arena', 7), [join(1)]);
}

/** A copy of the state with one character's health set directly. */
function withHealth(state: WorldState, id: number, health: number): WorldState {
  return { ...state, characters: state.characters.map((c) => (c.id === id ? { ...c, health } : c)) };
}

/** A debug intention from character 1, at subtick 0 unless `fields` says otherwise. */
function debug(fields: Record<string, unknown>): Intention {
  return { characterId: 1, subtick: 0, ...fields } as unknown as Intention;
}

describe('createWorld and createArenaWorld', () => {
  it('createWorld defaults to no content, seed 1, no campfire, no preset, no enemies and no events', () => {
    const world = createWorld(open(5, 5), t(2, 2));
    expect(world.content).toEqual(EMPTY_CONTENT);
    expect(world.rng).toBe(1);
    expect(world.campfire).toBeNull();
    expect(world.startingPresetId).toBeNull();
    expect(world.enemies).toEqual([]);
    expect(world.nextEnemyId).toBe(1);
    expect([world.hits, world.downed, world.respawned, world.recaps]).toEqual([[], [], [], []]);
  });

  it('a join in an empty-content world has no preset and the base health', () => {
    const world = step(createWorld(open(5, 5), t(2, 2)), [join(1)]);
    const character = characterOf(world, 1);
    expect(character.sheet).toEqual(newSheet(EMPTY_CONTENT, null));
    expect(character.health).toBe(33); // 30 + 3 x Vigor 1
    expect(character.order).toEqual({ kind: 'none' });
    expect(character.recentHits).toEqual([]);
  });

  it('createArenaWorld uses the arena rows, spawn, campfire (blocked) and seed', () => {
    const world = createArenaWorld(content, 'arena', 12345);
    expect(world.spawn).toEqual(t(12, 19));
    expect(world.campfire).toEqual(t(12, 20));
    expect(world.grid.blocked[20 * world.grid.width + 12]).toBe(true);
    expect(world.grid.width).toBe(24);
    expect(world.rng).toBe(12345);
    expect(world.content).toBe(content);
    expect(world.startingPresetId).toBe('militia');
  });

  it('createArenaWorld throws on an unknown arena, including inherited names', () => {
    expect(() => createArenaWorld(content, 'nope', 1)).toThrow();
    expect(() => createArenaWorld(content, 'constructor', 1)).toThrow();
  });

  it('a joining player has the militia sheet, 36 health, and stands on (12,19)', () => {
    const character = characterOf(arenaWithOne(), 1);
    expect(character.sheet).toEqual(newSheet(content, 'militia'));
    expect(character.sheet.weaponId).toBe('rusty-shortsword');
    expect(character.health).toBe(36);
    expect(character.tile).toEqual(t(12, 19));
    expect(character.nextAttackTick).toBe(0);
  });

  it('step clears the event lists every tick', () => {
    const stale: WorldState = {
      ...arenaWithOne(),
      downed: [1],
      respawned: [1],
      recaps: [{ characterId: 1, tick: 0, hits: [] }],
    };
    const after = step(stale, []);
    expect([after.hits, after.downed, after.respawned, after.recaps]).toEqual([[], [], [], []]);
  });
});

describe('step: debug intentions', () => {
  /** The arena with player 1 joined and hurt to 10 health, so a wrongful heal shows. */
  const hurt = (): WorldState => withHealth(arenaWithOne(), 1, 10);

  it('debug-level 5 gives Might 8 and full health', () => {
    const world = step(hurt(), [debug({ kind: 'debug-level', level: 5 })]);
    const character = characterOf(world, 1);
    expect(character.sheet.level).toBe(5);
    expect(attributesOf(character.sheet, content).might).toBe(8);
    expect(character.health).toBe(maxHealthOf(character.sheet, content));
    expect(character.health).toBe(56);
  });

  it('debug-weapon hunting-bow equips the bow and heals', () => {
    const character = characterOf(step(hurt(), [debug({ kind: 'debug-weapon', itemId: 'hunting-bow' })]), 1);
    expect(character.sheet.weaponId).toBe('hunting-bow');
    expect(character.health).toBe(36);
  });

  it('debug-weapon null and debug-armor null unequip and heal', () => {
    const world = step(hurt(), [debug({ kind: 'debug-weapon', itemId: null }), debug({ kind: 'debug-armor', itemId: null })]);
    const character = characterOf(world, 1);
    expect(character.sheet.weaponId).toBeNull();
    expect(character.sheet.armorId).toBeNull();
    expect(character.health).toBe(36);
  });

  it('debug-heal restores full health', () => {
    const character = characterOf(step(hurt(), [debug({ kind: 'debug-heal' })]), 1);
    expect(character.health).toBe(36);
  });

  it('debug-preset switches the preset gear and attributes, and heals', () => {
    const character = characterOf(step(hurt(), [debug({ kind: 'debug-preset', presetId: 'hunter' })]), 1);
    expect(character.sheet.presetId).toBe('hunter');
    expect(character.sheet.weaponId).toBe('hunting-bow');
    expect(character.health).toBe(36);
  });

  it('debug intentions apply one after another in (subtick, id) order', () => {
    const world = step(hurt(), [
      debug({ kind: 'debug-level', level: 3, subtick: 2 }),
      debug({ kind: 'debug-preset', presetId: 'hunter', subtick: 1 }),
    ]);
    // The preset first, then the level: both new points go to Finesse (1 + 3 birth + 2).
    expect(attributesOf(characterOf(world, 1).sheet, content).finesse).toBe(6);
  });

  it('debug-move-point moves a level point and heals to the new max', () => {
    let world = step(hurt(), [debug({ kind: 'debug-level', level: 3 })]);
    world = withHealth(world, 1, 10);
    world = step(world, [debug({ kind: 'debug-move-point', from: 'might', to: 'vigor' })]);
    const character = characterOf(world, 1);
    expect(attributesOf(character.sheet, content)).toMatchObject({ might: 5, vigor: 3 });
    expect(character.health).toBe(30 + 2 * 5 + 3 * 3);
  });

  it('debug-class-rank sets a class rank and heals', () => {
    const character = characterOf(step(hurt(), [debug({ kind: 'debug-class-rank', classId: 'militia', rank: 3 })]), 1);
    expect(character.sheet.classRanks.militia).toBe(3);
    expect(character.health).toBe(36);
  });

  it('invalid ids and values change nothing, not even health', () => {
    const before = hurt();
    const unchanged = step(before, []);
    const hostile = [
      debug({ kind: 'debug-weapon', itemId: 'leather-jerkin' }),
      debug({ kind: 'debug-armor', itemId: 'hunting-bow' }),
      debug({ kind: 'debug-level', level: 11 }),
      debug({ kind: 'debug-level', level: 0 }),
      debug({ kind: 'debug-level', level: 1.5 }),
      debug({ kind: 'debug-move-point', from: 'might', to: 'vigor' }), // no level points to move at level 1
      debug({ kind: 'debug-move-point', from: 'constructor', to: 'vigor' }),
      debug({ kind: 'debug-class-rank', classId: 'militia', rank: 4 }),
      debug({ kind: 'debug-bogus' }),
      debug({ kind: 7 }),
      ...['constructor', 'nope', 'toString', '__proto__'].flatMap((id) => [
        debug({ kind: 'debug-preset', presetId: id }),
        debug({ kind: 'debug-weapon', itemId: id }),
        debug({ kind: 'debug-armor', itemId: id }),
        debug({ kind: 'debug-class-rank', classId: id, rank: 2 }),
        debug({ kind: 'debug-start-wave', waveId: id }),
      ]),
    ];
    for (const intention of hostile) {
      expect(step(before, [intention]), JSON.stringify(intention)).toEqual(unchanged);
    }
    expect(step(before, hostile)).toEqual(unchanged);
  });

  it('debug intentions from a character not in the world are ignored', () => {
    const before = hurt();
    const stranger = (fields: Record<string, unknown>): Intention =>
      ({ characterId: 99, subtick: 0, ...fields }) as unknown as Intention;
    const after = step(before, [stranger({ kind: 'debug-heal' }), stranger({ kind: 'debug-start-wave', waveId: 'practice' })]);
    expect(after).toEqual(step(before, []));
  });

  it("debug-start-wave 'practice' places the dummy and the slime", () => {
    const world = step(arenaWithOne(), [debug({ kind: 'debug-start-wave', waveId: 'practice' })]);
    expect(world.enemies.map((e) => ({ id: e.id, contentId: e.contentId, tile: e.tile }))).toEqual([
      { id: 1, contentId: 'training-dummy', tile: t(8, 4) },
      { id: 2, contentId: 'slime', tile: t(15, 4) },
    ]);
    expect(world.enemies[1]).toEqual({
      id: 2,
      contentId: 'slime',
      tile: t(15, 4),
      path: [],
      speed: 500,
      progress: STEP,
      stepped: [],
      health: 12,
      lastDamagedBy: null,
      lastHitTick: null,
      windup: null,
      readyTick: 1,
    });
    expect(world.nextEnemyId).toBe(3);
  });

  it("a second start-wave 'wave-1' gives ids 3, 4 and 5 and removes the old enemies", () => {
    let world = step(arenaWithOne(), [debug({ kind: 'debug-start-wave', waveId: 'practice' })]);
    world = step(world, [debug({ kind: 'debug-start-wave', waveId: 'wave-1' })]);
    expect(world.enemies.map((e) => ({ id: e.id, contentId: e.contentId, tile: e.tile }))).toEqual([
      { id: 3, contentId: 'slime', tile: t(6, 3) },
      { id: 4, contentId: 'slime', tile: t(12, 3) },
      { id: 5, contentId: 'slime', tile: t(18, 3) },
    ]);
    expect(world.nextEnemyId).toBe(6);
  });

  it('debug-clear-enemies leaves no enemies, and the ids keep counting', () => {
    let world = step(arenaWithOne(), [debug({ kind: 'debug-start-wave', waveId: 'practice' })]);
    world = step(world, [debug({ kind: 'debug-clear-enemies' })]);
    expect(world.enemies).toEqual([]);
    world = step(world, [debug({ kind: 'debug-start-wave', waveId: 'practice' })]);
    expect(world.enemies.map((e) => e.id)).toEqual([3, 4]);
  });

  it('leaves the input state and intentions unchanged', () => {
    const started = step(arenaWithOne(), [debug({ kind: 'debug-start-wave', waveId: 'practice' })]);
    const before = withHealth(started, 1, 10);
    const snapshot = structuredClone(before);
    const intentions = [
      debug({ kind: 'debug-level', level: 4 }),
      debug({ kind: 'debug-start-wave', waveId: 'wave-1' }),
      move(1, t(12, 10)),
    ];
    const intentionsSnapshot = structuredClone(intentions);
    step(before, intentions);
    expect(before).toEqual(snapshot);
    expect(intentions).toEqual(intentionsSnapshot);
  });
});
