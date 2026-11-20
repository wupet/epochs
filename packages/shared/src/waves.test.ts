// These tests read the real `content/` folder with Node's file system (tests are type-checked with Node types).
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildContentBundle,
  clearEnemies,
  createArenaWorld,
  createWorld,
  findSpawnTile,
  gridFromRows,
  nearestFreeTile,
  nearness,
  sameTile,
  startWave,
  step,
} from './index';
import type { ContentBundle, Enemy, Tile, WorldState } from './index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** The real content bundle, built from the files under `content/`. */
function realContent(): ContentBundle {
  const files = readdirSync(`${repoRoot}content`, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => ({
      path: `content/${basename(e.parentPath)}/${e.name}`,
      text: readFileSync(join(e.parentPath, e.name), 'utf8'),
    }));
  const { bundle } = buildContentBundle(files);
  if (!bundle) throw new Error('The real content does not load.');
  return bundle;
}

const content = realContent();

function t(x: number, y: number): Tile {
  return { x, y };
}

/** The arena with players joined, then each placed directly on the given tile. */
function arenaWithPlayersOn(tiles: readonly Tile[]): WorldState {
  const joins = tiles.map((_, i) => ({ kind: 'join' as const, characterId: i + 1, subtick: 0 }));
  const world = step(createArenaWorld(content, 'arena', 1), joins);
  return { ...world, characters: world.characters.map((c, i) => ({ ...c, tile: tiles[i]! })) };
}

/** An enemy standing still on a tile, for hand-built states. */
function enemyOn(id: number, tile: Tile): Enemy {
  return {
    id,
    contentId: 'slime',
    tile,
    path: [],
    speed: 500,
    progress: 1000,
    stepped: [],
    health: 12,
    lastDamagedBy: null,
    lastHitTick: null,
    windup: null,
    readyTick: 0,
  };
}

describe('nearestFreeTile', () => {
  const grid = gridFromRows(['.....', '.#...', '.....']);

  it('returns the tile itself when it is free', () => {
    expect(nearestFreeTile(grid, t(2, 2), () => false)).toEqual(t(2, 2));
  });

  it('returns the first free tile outward, in STEP_DIRECTIONS order', () => {
    expect(nearestFreeTile(grid, t(2, 2), (tile) => sameTile(tile, t(2, 2)))).toEqual(t(2, 1));
  });

  it('walks outward around walls', () => {
    const taken = [t(0, 0), t(1, 0), t(0, 1), t(0, 2), t(1, 2)];
    const found = nearestFreeTile(grid, t(0, 0), (tile) => taken.some((x) => sameTile(x, tile)));
    expect(found).toEqual(t(2, 0));
  });

  it('returns null when every reachable tile is taken, or the tile is not walkable', () => {
    expect(nearestFreeTile(grid, t(0, 0), () => true)).toBeNull();
    expect(nearestFreeTile(grid, t(1, 1), () => false)).toBeNull();
    expect(nearestFreeTile(grid, t(9, 9), () => false)).toBeNull();
  });
});

describe('findSpawnTile', () => {
  it('treats enemy tiles as taken', () => {
    const world = createWorld(gridFromRows(['.....', '.....', '.....']), t(2, 1));
    const crowded: WorldState = { ...world, enemies: [enemyOn(1, t(2, 1))] };
    expect(findSpawnTile(crowded)).toEqual(t(2, 0));
    const joined = step(crowded, [{ kind: 'join', characterId: 1, subtick: 0 }]);
    expect(joined.characters[0]!.tile).toEqual(t(2, 0));
  });
});

describe('startWave', () => {
  it('places each enemy on its tile with the content stats, ids from nextEnemyId', () => {
    const world = startWave(arenaWithPlayersOn([]), 'practice');
    expect(world.enemies.map((e) => [e.id, e.contentId, e.tile, e.health, e.speed])).toEqual([
      [1, 'training-dummy', t(8, 4), 1000, 0],
      [2, 'slime', t(15, 4), 12, 500],
    ]);
    expect(world.nextEnemyId).toBe(3);
  });

  it("a player standing on (15,4) when the practice wave starts: the slime appears on a free neighbouring tile", () => {
    const before = arenaWithPlayersOn([t(15, 4)]);
    const world = step(before, [{ kind: 'debug-start-wave', characterId: 1, waveId: 'practice', subtick: 0 }]);
    const slime = world.enemies.find((e) => e.contentId === 'slime')!;
    expect(sameTile(slime.tile, t(15, 4))).toBe(false);
    expect(nearness(slime.tile, t(15, 4))).toBe(1);
    expect(world.characters[0]!.tile).toEqual(t(15, 4));
  });

  it('players on every spawn tile and its neighbours: each enemy still gets a tile of its own', () => {
    const crowd: Tile[] = [];
    for (const centre of [t(8, 4), t(15, 4)]) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) crowd.push(t(centre.x + dx, centre.y + dy));
    }
    const world = startWave(arenaWithPlayersOn(crowd), 'practice');
    expect(world.enemies).toHaveLength(2);
    const occupied = [...crowd, ...world.enemies.map((e) => e.tile)];
    for (const enemy of world.enemies) {
      expect(occupied.filter((tile) => sameTile(tile, enemy.tile))).toHaveLength(1);
      expect(world.grid.blocked[enemy.tile.y * world.grid.width + enemy.tile.x]).toBe(false);
    }
  });

  it('two wave enemies never share a tile, even when the wave puts them on the same one', () => {
    const stacked = {
      id: 'stacked',
      name: 'Stacked',
      arena: 'arena',
      enemies: [
        { enemy: 'slime', x: 5, y: 5 },
        { enemy: 'slime', x: 5, y: 5 },
        { enemy: 'slime', x: 5, y: 5 },
      ],
    };
    const base = arenaWithPlayersOn([t(5, 4)]);
    const world = startWave({ ...base, content: { ...content, waves: { ...content.waves, stacked } } }, 'stacked');
    const tiles = [...world.enemies.map((e) => e.tile), t(5, 4)].map((tile) => `${tile.x},${tile.y}`);
    expect(world.enemies).toHaveLength(3);
    expect(new Set(tiles).size).toBe(4);
    expect(world.enemies[0]!.tile).toEqual(t(5, 5));
  });

  it('skips an enemy whose content id is unknown', () => {
    const odd = { id: 'odd', name: 'Odd', arena: 'arena', enemies: [{ enemy: 'constructor', x: 5, y: 5 }, { enemy: 'slime', x: 6, y: 5 }] };
    const base = arenaWithPlayersOn([]);
    const world = startWave({ ...base, content: { ...content, waves: { ...content.waves, odd } } }, 'odd');
    expect(world.enemies.map((e) => [e.id, e.contentId])).toEqual([[1, 'slime']]);
  });

  it('clears the old enemies first and keeps counting ids', () => {
    const world = startWave(startWave(arenaWithPlayersOn([]), 'practice'), 'practice');
    expect(world.enemies.map((e) => e.id)).toEqual([3, 4]);
  });

  it('an unknown wave, including inherited names, returns the same state', () => {
    const before = startWave(arenaWithPlayersOn([]), 'practice');
    for (const id of ['nope', 'constructor', 'toString', '__proto__']) expect(startWave(before, id)).toBe(before);
  });
});

describe('clearEnemies', () => {
  it('removes every enemy and keeps nextEnemyId', () => {
    const world = clearEnemies(startWave(arenaWithPlayersOn([]), 'wave-1'));
    expect(world.enemies).toEqual([]);
    expect(world.nextEnemyId).toBe(4);
  });
});
