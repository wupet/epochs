import { describe, expect, it } from 'vitest';
import {
  DEBUG_MOVEMENT_MODES,
  DEFAULT_SPEED,
  MAX_SPEED,
  MAX_STEPS_PER_TICK,
  STEP,
  createWorld,
  findSpawnTile,
  gridFromRows,
  isDebugMovementMode,
  sameTile,
  step,
} from './index';
import type { DebugMovementMode, Grid, Intention, Tile, WorldState } from './index';

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
      { id: 1, tile: t(2, 2), path: [], speed: DEFAULT_SPEED, progress: STEP, stepped: [] },
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
        { id: 1, tile: t(0, 0), path: [t(2, 0)], speed: DEFAULT_SPEED, progress: STEP, stepped: [] },
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

  it('a rider on a horse moves 1, then 2, then 2 tiles, and records the tiles entered in order', () => {
    const { stepped, end } = stepTicks(movementWorld(), [[mode(1, 'horse'), move(1, t(6, 5))], ...idle(3)]);
    expect(stepped.map((s) => s.length)).toEqual([1, 2, 2, 0]);
    expect(stepped[0]).toEqual([t(2, 5)]);
    expect(stepped[1]).toEqual([t(3, 5), t(4, 5)]);
    expect(stepped[2]).toEqual([t(5, 5), t(6, 5)]);
    expect(tileOf(end, 1)).toEqual(t(6, 5));
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

  /**
   * Every tick, sends a move to whichever of (5,5) and (6,5) the walker is NOT on, so every tick
   * re-routes it one tile away. Returns how many ticks changed its tile, and the most tiles stepped
   * in one tick, and whether two consecutive ticks both changed it.
   */
  function spamBetweenTwoTiles(speed: number, ticks: number) {
    const base = withSpeed(movementWorld(), speed);
    let world: WorldState = { ...base, characters: [{ ...characterOf(base, 1), tile: t(5, 5) }] };
    let changedTicks = 0;
    let mostStepped = 0;
    let consecutive = false;
    let previousChanged = false;
    for (let i = 0; i < ticks; i++) {
      const before = tileOf(world, 1);
      const other = sameTile(before, t(5, 5)) ? t(6, 5) : t(5, 5);
      world = step(world, [move(1, other)]);
      const changed = !sameTile(before, tileOf(world, 1));
      if (changed) changedTicks++;
      if (changed && previousChanged) consecutive = true;
      previousChanged = changed;
      mostStepped = Math.max(mostStepped, characterOf(world, 1).stepped.length);
    }
    return { changedTicks, mostStepped, consecutive };
  }

  it('spam-clicking away from a walker on one of two adjacent tiles gives exactly one step every 2 ticks', () => {
    // The walker starts rested (progress 1000): it steps on ticks 1, 3, 5 ... 39, and each re-route
    // keeps its progress, so it never steps two ticks in a row. 20 steps in 40 ticks.
    const { changedTicks, mostStepped, consecutive } = spamBetweenTwoTiles(DEFAULT_SPEED, 40);
    expect(consecutive).toBe(false); // never two consecutive steps
    expect(mostStepped).toBe(1);
    expect(changedTicks).toBe(20);
  });

  it('the same spam on a horse is capped by the one-tile path, not by speed: one step per tick', () => {
    // A horse has 2000 speed, but each re-route is a one-tile path and resting caps progress at one
    // step, so it steps once on every tick: 40 steps in 40 ticks, never 2 in a tick.
    const { changedTicks, mostStepped } = spamBetweenTwoTiles(MAX_SPEED, 40);
    expect(mostStepped).toBe(1);
    expect(changedTicks).toBe(40);
  });

  it('a re-route on the tick after a step does not step that tick, and steps on the one after', () => {
    let world = step(movementWorld(), [move(1, t(8, 5))]); // tick 1: steps
    expect(tileOf(world, 1)).toEqual(t(2, 5));
    world = step(world, [move(1, t(2, 9))]); // tick 2: re-routed, no step
    expect(tileOf(world, 1)).toEqual(t(2, 5));
    world = step(world, []); // tick 3: steps toward the new target
    expect(tileOf(world, 1)).toEqual(t(2, 6));
  });

  it('resting caps progress at one step, at any speed', () => {
    for (const speed of [DEFAULT_SPEED, 750, MAX_SPEED]) {
      let world = withSpeed(movementWorld(), speed);
      for (let i = 0; i < 10; i++) world = step(world, []);
      expect(characterOf(world, 1).progress).toBe(STEP);
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
