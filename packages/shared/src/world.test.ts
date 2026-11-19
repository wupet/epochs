import { describe, expect, it } from 'vitest';
import { createWorld, findSpawnTile, gridFromRows, sameTile, step } from './index';
import type { Grid, Intention, Tile, WorldState } from './index';

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
    expect(world.characters).toEqual([{ id: 1, tile: t(2, 2), path: [] }]);
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
  it('advances exactly one tile per step and arrives after 3 steps', () => {
    let world = worldWithOne();
    world = step(world, [move(1, t(7, 4))]);
    expect(tileOf(world, 1)).toEqual(t(5, 4));
    expect(pathOf(world, 1)).toEqual([t(6, 4), t(7, 4)]);
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(6, 4));
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(7, 4));
    expect(pathOf(world, 1)).toEqual([]);
    world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(7, 4));
  });

  it('a new move mid-walk heads toward the new target on the very next step', () => {
    let world = worldWithOne();
    world = step(world, [move(1, t(8, 4))]); // now at (5,4)
    world = step(world, []); // now at (6,4)
    world = step(world, [move(1, t(6, 8))]);
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
    for (let i = 0; i < 10; i++) world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(8, 8));
    expect(tileOf(world, 2)).toEqual(t(8, 8));
  });

  it('a diagonal step from (2,2) to (3,3) takes one tick', () => {
    let world = step(createWorld(open(6, 6), t(2, 2)), [join(1)]);
    world = step(world, [move(1, t(3, 3))]);
    expect(tileOf(world, 1)).toEqual(t(3, 3));
    expect(pathOf(world, 1)).toEqual([]);
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
    expect(tileOf(world, 1)).toEqual(t(2, 1));
  });

  it('clears the path when the next step is no longer allowed', () => {
    const grid = gridFromRows(['...']);
    const base = step(createWorld(grid, t(0, 0)), [join(1)]);
    const stale: WorldState = {
      ...base,
      characters: [{ id: 1, tile: t(0, 0), path: [t(2, 0)] }],
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
