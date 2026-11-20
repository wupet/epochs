// The arena test reads the real `content/` folder with Node's file system (tests are type-checked with Node types).
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_SPEED,
  STEP,
  buildContentBundle,
  createArenaWorld,
  createWorld,
  gridFromRows,
  nearness,
  sameTile,
  step,
  walk,
  withBlockers,
} from './index';
import type { ContentBundle, Enemy, Intention, Tile, Walker, WorldState } from './index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** The real content bundle, built from the files under `content/`. */
function realContent(): ContentBundle {
  const files = readdirSync(`${repoRoot}content`, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => ({
      path: `content/${basename(e.parentPath)}/${e.name}`,
      text: readFileSync(joinPath(e.parentPath, e.name), 'utf8'),
    }));
  const { bundle } = buildContentBundle(files);
  if (!bundle) throw new Error('The real content does not load.');
  return bundle;
}

function t(x: number, y: number): Tile {
  return { x, y };
}

function walker(fields: Partial<Walker>): Walker {
  return { tile: t(0, 0), path: [], speed: 500, progress: STEP, stepped: [], ...fields };
}

const noReroute = (): readonly Tile[] => {
  throw new Error('No re-route expected');
};

function enemyOn(id: number, tile: Tile, path: readonly Tile[] = []): Enemy {
  return {
    id,
    contentId: 'slime',
    tile,
    path,
    speed: 500,
    progress: STEP,
    stepped: [],
    health: 12,
    lastDamagedBy: null,
    lastHitTick: null,
    windup: null,
    readyTick: 0,
  };
}

function join(characterId: number): Intention {
  return { kind: 'join', characterId, subtick: 0 };
}

function move(characterId: number, target: Tile): Intention {
  return { kind: 'move', characterId, target, subtick: 0 };
}

function tileOf(state: WorldState, id: number): Tile {
  const character = state.characters.find((c) => c.id === id);
  if (!character) throw new Error(`No character ${id}`);
  return character.tile;
}

/** No enemy shares a tile with a player or with another enemy. */
function expectNoSharing(state: WorldState): void {
  for (const enemy of state.enemies) {
    for (const c of state.characters) expect(sameTile(enemy.tile, c.tile), `tick ${state.tick}`).toBe(false);
    for (const other of state.enemies) {
      if (other.id !== enemy.id) expect(sameTile(enemy.tile, other.tile), `tick ${state.tick}`).toBe(false);
    }
  }
}

describe('walk', () => {
  const terrain = gridFromRows(['....', '....', '....', '....']);

  it('steps along the path, paying STEP, and keeps the mover fields it does not use', () => {
    const mover = { ...walker({ path: [t(1, 0), t(2, 0)] }), id: 7 };
    const after = walk(mover, terrain, terrain, noReroute);
    expect(after).toEqual({ id: 7, tile: t(1, 0), path: [t(2, 0)], speed: 500, progress: 500, stepped: [t(1, 0)] });
  });

  it('clears a path whose next step is illegal on the terrain, without re-routing', () => {
    const after = walk(walker({ path: [t(2, 0)] }), terrain, terrain, noReroute);
    expect(after.path).toEqual([]);
    expect(after.tile).toEqual(t(0, 0));
    expect(after.progress).toBe(STEP);
  });

  it('re-routes once when an occupied tile blocks the next step, and takes the new route', () => {
    const blockers = withBlockers(terrain, [t(1, 0)]);
    const calls: Tile[] = [];
    const after = walk(walker({ path: [t(1, 0), t(2, 0)] }), blockers, terrain, (from) => {
      calls.push(from);
      return [t(0, 1), t(1, 1), t(2, 0)];
    });
    expect(calls).toEqual([t(0, 0)]);
    expect(after.tile).toEqual(t(0, 1));
    expect(after.path).toEqual([t(1, 1), t(2, 0)]);
    expect(after.stepped).toEqual([t(0, 1)]);
  });

  it('with no legal step after the re-route, waits: keeps the old path, and caps progress', () => {
    const blockers = withBlockers(terrain, [t(1, 0)]);
    const mover = walker({ path: [t(1, 0), t(2, 0)], progress: STEP });
    const after = walk(mover, blockers, terrain, () => []);
    expect(after.tile).toEqual(t(0, 0));
    expect(after.path).toEqual([t(1, 0), t(2, 0)]);
    expect(after.stepped).toEqual([]);
    expect(after.progress).toBe(STEP); // waiting banks no free steps
  });

  it('never squeezes diagonally between two occupied tiles', () => {
    const blockers = withBlockers(terrain, [t(1, 0), t(0, 1)]);
    const after = walk(walker({ path: [t(1, 1)] }), blockers, terrain, () => []);
    expect(after.tile).toEqual(t(0, 0));
    expect(after.path).toEqual([t(1, 1)]);
  });

  it('re-routes from where the mover stands when the second step of a tick is blocked', () => {
    const blockers = withBlockers(terrain, [t(2, 0)]);
    const calls: Tile[] = [];
    const after = walk(
      walker({ path: [t(1, 0), t(2, 0), t(3, 0)], speed: MAX_SPEED, progress: MAX_SPEED }),
      blockers,
      terrain,
      (from) => {
        calls.push(from);
        return [t(1, 1), t(2, 1), t(3, 0)];
      },
    );
    expect(calls).toEqual([t(1, 0)]);
    expect(after.stepped).toEqual([t(1, 0), t(1, 1)]);
    expect(after.path).toEqual([t(2, 1), t(3, 0)]);
  });

  it('re-routes at most once per tick', () => {
    const blockers = withBlockers(terrain, [t(1, 0), t(1, 2)]);
    let calls = 0;
    const after = walk(
      walker({ path: [t(1, 0), t(2, 0)], speed: MAX_SPEED, progress: MAX_SPEED }),
      blockers,
      terrain,
      () => {
        calls++;
        return [t(0, 1), t(1, 2), t(2, 2)]; // a stale route: its second tile is occupied too
      },
    );
    expect(calls).toBe(1);
    expect(after.stepped).toEqual([t(0, 1)]);
    expect(after.path).toEqual([t(1, 2), t(2, 2)]);
    expect(after.progress).toBe(MAX_SPEED); // waited on the second step: capped at one tick's worth
  });
});

describe('step: enemies block movement', () => {
  it("a player ordered to move onto the dummy's tile stops next to it", () => {
    const content = realContent();
    let world = step(createArenaWorld(content, 'arena', 1), [join(1)]);
    world = step(world, [{ kind: 'debug-start-wave', characterId: 1, waveId: 'practice', subtick: 0 }]);
    const dummy = world.enemies.find((e) => e.contentId === 'training-dummy')!;
    world = step(world, [move(1, dummy.tile)]);
    for (let i = 0; i < 60; i++) {
      world = step(world, []);
      expectNoSharing(world);
    }
    expect(nearness(tileOf(world, 1), dummy.tile)).toBe(1);
    expect(world.characters[0]!.path).toEqual([]);
    expect(world.characters[0]!.order).toEqual({ kind: 'none' });
  });

  it('a player walking a corridor whose next tile an enemy steps into re-routes by the other lane, and never shares a tile with it', () => {
    // Two lanes from (0,2) to (4,2): the short one along row 2, the long one round the top.
    const grid = gridFromRows(['.....', '.###.', '.....', '##.##']);
    const joined = step(createWorld(grid, t(0, 2)), [join(1)]);
    // The enemy waits in the alcove below the corridor and steps up into it on tick 1.
    let world: WorldState = { ...joined, enemies: [enemyOn(1, t(2, 3), [t(2, 2)])], nextEnemyId: 2 };
    world = step(world, [move(1, t(4, 2))]); // the player steps to (1,2); then the enemy steps into (2,2)
    expect(tileOf(world, 1)).toEqual(t(1, 2));
    expect(world.enemies[0]!.tile).toEqual(t(2, 2));
    expectNoSharing(world);
    world = step(world, []); // a rest tick
    world = step(world, []); // the next step (2,2) is occupied: re-route by the top lane
    expect(tileOf(world, 1)).toEqual(t(0, 2));
    const visited: Tile[] = [];
    for (let i = 0; i < 30; i++) {
      world = step(world, []);
      expectNoSharing(world);
      visited.push(tileOf(world, 1));
    }
    expect(visited.some((tile) => sameTile(tile, t(2, 0)))).toBe(true);
    expect(tileOf(world, 1)).toEqual(t(4, 2));
  });

  it("an enemy can't step onto a player's tile: the player who got there first this tick keeps it", () => {
    const grid = gridFromRows(['.....']);
    const joined = step(createWorld(grid, t(0, 0)), [join(1)]);
    let world: WorldState = { ...joined, enemies: [enemyOn(1, t(2, 0), [t(1, 0), t(0, 0)])], nextEnemyId: 2 };
    world = step(world, [move(1, t(1, 0))]); // the player moves first, onto (1,0)
    expect(tileOf(world, 1)).toEqual(t(1, 0));
    expect(world.enemies[0]!.tile).toEqual(t(2, 0));
    expect(world.enemies[0]!.path).toEqual([t(1, 0), t(0, 0)]); // waiting, not giving up
    for (let i = 0; i < 6; i++) {
      world = step(world, []);
      expectNoSharing(world);
    }
  });

  it('an enemy that is blocked walks on once the way is clear', () => {
    const grid = gridFromRows(['.....']);
    const joined = step(createWorld(grid, t(0, 0)), [join(1)]);
    let world: WorldState = { ...joined, enemies: [enemyOn(1, t(3, 0), [t(2, 0), t(1, 0)])], nextEnemyId: 2 };
    world = { ...world, characters: world.characters.map((c) => ({ ...c, tile: t(2, 0) })) };
    world = step(world, []);
    expect(world.enemies[0]!.tile).toEqual(t(3, 0));
    world = step(world, [move(1, t(0, 0))]); // the player leaves (2,0) for (1,0); the enemy steps into (2,0) behind it
    expect(world.enemies[0]!.tile).toEqual(t(2, 0));
    expectNoSharing(world);
  });

  it('two players can still share a tile', () => {
    const content = realContent();
    let world = step(createArenaWorld(content, 'arena', 1), [join(1), join(2)]);
    world = step(world, [{ kind: 'debug-start-wave', characterId: 1, waveId: 'practice', subtick: 0 }]);
    world = step(world, [move(1, t(12, 12)), move(2, t(12, 12))]);
    for (let i = 0; i < 30; i++) world = step(world, []);
    expect(tileOf(world, 1)).toEqual(t(12, 12));
    expect(tileOf(world, 2)).toEqual(t(12, 12));
  });
});
