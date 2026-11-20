import { describe, expect, it } from 'vitest';
import type { EnemyView, QueueMessage, RecapMessage, SheetMessage, TickMessage, WelcomeMessage } from '@epochs/shared';
import { ClientWorld, parseServerMessage } from './client-world';
import { FLOAT_MS } from './floating-numbers';
import { msPerTile } from './motion';

const WALK_MS = msPerTile(500);

const welcome: WelcomeMessage = {
  type: 'welcome',
  you: 1,
  tick: 10,
  grid: { width: 5, height: 3, rows: ['.....', '..#..', '.....'] },
  characters: [
    { id: 1, x: 0, y: 0, speed: 500, health: 30, maxHealth: 30 },
    { id: 2, x: 4, y: 2, speed: 500, health: 30, maxHealth: 30 },
  ],
  campfire: null,
  enemies: [],
  telegraphs: [],
  catalog: { presets: [], weapons: [], armors: [], classes: [], waves: [], maxLevel: 10, maxClassRank: 3 },
};

function tick(n: number, parts: Partial<Omit<TickMessage, 'type' | 'tick'>> = {}): TickMessage {
  return {
    type: 'tick',
    tick: n,
    moved: [],
    joined: [],
    left: [],
    vitals: [],
    downed: [],
    respawned: [],
    enemies: { spawned: [], moved: [], removed: [], vitals: [] },
    telegraphs: [],
    hits: [],
    ...parts,
  };
}

function joined(): ClientWorld {
  const world = new ClientWorld();
  world.applyWelcome(welcome, 0);
  return world;
}

describe('ClientWorld', () => {
  it('starts empty, before any welcome', () => {
    const world = new ClientWorld();
    expect(world.you).toBeNull();
    expect(world.grid).toBeNull();
    expect(world.tick).toBe(-1);
    expect(world.ids()).toEqual([]);
    expect(world.applyTick(tick(0), 0)).toBe(false);
  });

  it('mirrors a welcome', () => {
    const world = joined();
    expect(world.you).toBe(1);
    expect(world.tick).toBe(10);
    expect(world.grid?.width).toBe(5);
    expect(world.grid?.blocked[1 * 5 + 2]).toBe(true);
    expect(world.tileOf(1)).toEqual({ x: 0, y: 0 });
    expect(world.tileOf(2)).toEqual({ x: 4, y: 2 });
    expect(world.positionOf(2, 0)).toEqual({ x: 4, y: 2 });
    expect(world.ids()).toEqual([1, 2]);
    expect(world.tileOf(99)).toBeUndefined();
    expect(world.positionOf(99, 0)).toBeUndefined();
  });

  it('a second welcome replaces everything', () => {
    const world = joined();
    world.applyWelcome({ ...welcome, you: 2, tick: 3, characters: [{ id: 2, x: 1, y: 1, speed: 500, health: 30, maxHealth: 30 }] }, 50);
    expect(world.you).toBe(2);
    expect(world.tick).toBe(3);
    expect(world.ids()).toEqual([2]);
    expect(world.positionOf(2, 50)).toEqual({ x: 1, y: 1 });
  });

  it('slides a walking character half a tile in 250 ms and onto the tile in 500 ms', () => {
    const world = joined();
    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 1000)).toBe(true);
    expect(world.tick).toBe(11);
    expect(world.tileOf(1)).toEqual({ x: 2, y: 0 });
    expect(world.positionOf(1, 1000)).toEqual({ x: 0, y: 0 });
    expect(world.positionOf(1, 1000 + WALK_MS / 2)).toEqual({ x: 1, y: 0 });
    expect(world.positionOf(1, 1000 + WALK_MS)).toEqual({ x: 2, y: 0 });
    // The other character did not move.
    expect(world.positionOf(2, 1000 + WALK_MS / 2)).toEqual({ x: 4, y: 2 });
  });

  it('slides from the drawn position when a tick arrives mid-slide', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 0);
    const mid = world.positionOf(1, WALK_MS / 2);
    world.applyTick(tick(12, { moved: [{ id: 1, x: 2, y: 2, speed: 500, health: 30, maxHealth: 30, via: [] }] }), WALK_MS / 2);
    expect(world.positionOf(1, WALK_MS / 2)).toEqual(mid);
    expect(world.positionOf(1, WALK_MS / 2 + WALK_MS)).toEqual({ x: 2, y: 2 });
  });

  it('adds joined characters still, and removes left ones', () => {
    const world = joined();
    world.applyTick(tick(11, { joined: [{ id: 3, x: 1, y: 2, speed: 500, health: 30, maxHealth: 30 }], left: [2] }), 500);
    expect(world.ids()).toEqual([1, 3]);
    expect(world.positionOf(3, 500)).toEqual({ x: 1, y: 2 });
    expect(world.tileOf(2)).toBeUndefined();
    expect(world.positionOf(2, 500)).toBeUndefined();
  });

  it('adds a moved character it does not know, still at its tile', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 7, x: 3, y: 1, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 500);
    expect(world.positionOf(7, 500)).toEqual({ x: 3, y: 1 });
    expect(world.tileOf(7)).toEqual({ x: 3, y: 1 });
  });

  it('ignores a tick at or before the current tick, and a repeated one', () => {
    const world = joined();
    const stale = tick(10, { moved: [{ id: 1, x: 3, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }], left: [2] });
    expect(world.applyTick(stale, 100)).toBe(false);
    expect(world.applyTick(tick(5, { left: [2] }), 100)).toBe(false);
    expect(world.tick).toBe(10);
    expect(world.tileOf(1)).toEqual({ x: 0, y: 0 });
    expect(world.ids()).toEqual([1, 2]);

    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 1, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 200)).toBe(true);
    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 210)).toBe(false);
    expect(world.tileOf(1)).toEqual({ x: 1, y: 0 });
    expect(world.tick).toBe(11);
  });

  it('settles on the last tile after 40 ticks applied at the same instant', () => {
    const world = joined();
    for (let i = 1; i <= 40; i++) {
      expect(world.applyTick(tick(10 + i, { moved: [{ id: 1, x: i % 5, y: 1, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 7000)).toBe(true);
    }
    expect(world.tileOf(1)).toEqual({ x: 0, y: 1 });
    expect(world.positionOf(1, 7000 + WALK_MS)).toEqual({ x: 0, y: 1 });
  });
});

describe('ClientWorld slide guards', () => {
  it('steady walking with up to 15 ms of jitter stays within 1.1 tiles of the server tile', () => {
    // One tile per message in a straight line, each arriving 500 ms (plus a deterministic offset) after the last.
    const offsets = [15, -15, 7, -7, 0];
    const world = joined();
    let at = 0;
    for (let k = 1; k <= 40; k++) {
      at += WALK_MS + offsets[k % offsets.length]!;
      world.applyTick(tick(10 + k, { moved: [{ id: 1, x: k, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), at);
      const behind = k - world.positionOf(1, at)!.x;
      expect(behind, `lag after message ${k}`).toBeLessThanOrEqual(1.1);
    }
  });

  it('40 straight walk ticks applied at the same instant land on the last tile one segment later', () => {
    const world = joined();
    for (let k = 1; k <= 40; k++) {
      world.applyTick(tick(10 + k, { moved: [{ id: 1, x: k, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 9000);
    }
    expect(world.tileOf(1)).toEqual({ x: 40, y: 0 });
    expect(world.positionOf(1, 9000 + WALK_MS)).toEqual({ x: 40, y: 0 });
  });
});

describe('ClientWorld speeds, via and queue', () => {
  it('a horse moving two tiles in a tick slides through its via tile, never cutting the corner', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 1, x: 1, y: 1, speed: 2000, health: 30, maxHealth: 30, via: [{ x: 1, y: 0 }] }] }), 0);
    expect(world.positionOf(1, 0)).toEqual({ x: 0, y: 0 });
    expect(world.positionOf(1, 125)).toEqual({ x: 1, y: 0 });
    expect(world.positionOf(1, 250)).toEqual({ x: 1, y: 1 });
    for (let ms = 0; ms <= 250; ms += 5) {
      expect(world.positionOf(1, ms)).not.toEqual({ x: 0.5, y: 0.5 });
    }
  });

  it('stores speeds from welcome, joined and moved, and speedOf is undefined for strangers', () => {
    const world = joined();
    expect(world.speedOf(1)).toBe(500);
    expect(world.speedOf(99)).toBeUndefined();
    world.applyTick(tick(11, { joined: [{ id: 3, x: 1, y: 2, speed: 1000, health: 30, maxHealth: 30 }] }), 0);
    expect(world.speedOf(3)).toBe(1000);
    world.applyTick(tick(12, { moved: [{ id: 1, x: 1, y: 0, speed: 2000, health: 30, maxHealth: 30, via: [] }] }), 10);
    expect(world.speedOf(1)).toBe(2000);
    world.applyTick(tick(13, { left: [3] }), 20);
    expect(world.speedOf(3)).toBeUndefined();
  });

  it('the first step after a speed change slides at the new speed', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 1, x: 1, y: 0, speed: 1000, health: 30, maxHealth: 30, via: [] }] }), 0);
    expect(world.positionOf(1, 125)).toEqual({ x: 0.5, y: 0 });
    expect(world.positionOf(1, 250)).toEqual({ x: 1, y: 0 });
  });

  it('keeps a queue position until a welcome clears it', () => {
    const world = new ClientWorld();
    expect(world.queuePosition).toBeNull();
    const msg: QueueMessage = { type: 'queue', position: 3 };
    world.applyQueue(msg);
    expect(world.queuePosition).toBe(3);
    world.applyWelcome(welcome, 0);
    expect(world.queuePosition).toBeNull();
  });

  it('notes that the server is full', () => {
    const world = new ClientWorld();
    expect(world.serverFull).toBe(false);
    world.applyFull();
    expect(world.serverFull).toBe(true);
  });
});

describe('parseServerMessage', () => {
  it('rejects junk', () => {
    expect(parseServerMessage('x')).toBeNull();
    expect(parseServerMessage('{}')).toBeNull();
    expect(parseServerMessage('{"type":"nope"}')).toBeNull();
    expect(parseServerMessage('[]')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
    expect(parseServerMessage('5')).toBeNull();
  });

  it('accepts a queue message', () => {
    const q: QueueMessage = { type: 'queue', position: 2 };
    expect(parseServerMessage(JSON.stringify(q))).toEqual(q);
  });

  it('accepts a full message', () => {
    expect(parseServerMessage('{"type":"full"}')).toEqual({ type: 'full' });
  });

  it('accepts a welcome or a tick', () => {
    expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
    const t = tick(11);
    expect(parseServerMessage(JSON.stringify(t))).toEqual(t);
  });
});

const slime = (id: number, x: number, y: number, health = 10): EnemyView => ({
  id,
  x,
  y,
  speed: 500,
  name: 'Slime',
  family: 'slime',
  health,
  maxHealth: 10,
});

const sheetMsg: SheetMessage = {
  type: 'sheet',
  presetId: null,
  level: 1,
  attributes: { might: 1, finesse: 1, vigor: 1, wits: 1, spirit: 1 },
  levelPoints: { might: 0, finesse: 0, vigor: 0, wits: 0, spirit: 0 },
  weaponId: null,
  armorId: null,
  classRanks: {},
  maxHealth: 30,
};

const recapMsg: RecapMessage = {
  type: 'recap',
  tick: 20,
  hits: [{ tick: 19, attacker: 'Slime', attack: 'Touch', amount: 5, telegraph: { name: 'Touch', windupTicks: 2 } }],
};

const withEnemies = (enemies: EnemyView[]): WelcomeMessage => ({
  ...welcome,
  campfire: { x: 1, y: 1 },
  enemies,
  telegraphs: [{ enemyId: 5, tiles: [{ x: 1, y: 0 }], kind: 'force', resolvesAt: 12 }],
});

function enemyTick(n: number, parts: Partial<TickMessage['enemies']>, now: number, world: ClientWorld): void {
  world.applyTick(tick(n, { enemies: { spawned: [], moved: [], removed: [], vitals: [], ...parts } }), now);
}

describe('ClientWorld combat state', () => {
  it('mirrors campfire, catalog, telegraphs, enemies and health from a welcome', () => {
    const world = new ClientWorld();
    expect(world.campfire).toBeNull();
    expect(world.catalog).toBeNull();
    expect(world.sheet).toBeNull();
    expect(world.recap).toBeNull();
    expect(world.telegraphs).toEqual([]);
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    expect(world.campfire).toEqual({ x: 1, y: 1 });
    expect(world.catalog).toBe(welcome.catalog);
    expect(world.telegraphs).toHaveLength(1);
    expect(world.enemyIds()).toEqual([5]);
    expect(world.enemyTileOf(5)).toEqual({ x: 3, y: 0 });
    expect(world.enemyPositionOf(5, 0)).toEqual({ x: 3, y: 0 });
    expect(world.enemyInfo(5)).toEqual({ name: 'Slime', family: 'slime', health: 10, maxHealth: 10 });
    expect(world.enemyInfo(99)).toBeUndefined();
    expect(world.healthOf(1)).toBe(30);
    expect(world.maxHealthOf(2)).toBe(30);
    expect(world.healthOf(99)).toBeUndefined();
    expect(world.maxHealthOf(99)).toBeUndefined();
  });

  it('a second welcome clears enemies, sheet, recap and numbers', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    world.applyRecap(recapMsg);
    world.applySheet(sheetMsg);
    world.applyWelcome(welcome, 5);
    expect(world.enemyIds()).toEqual([]);
    expect(world.campfire).toBeNull();
    expect(world.sheet).toBeNull();
    expect(world.recap).toBeNull();
    expect(world.telegraphs).toEqual([]);
    expect(world.floatingNumbers(5)).toEqual([]);
  });

  it('spawned enemies appear still, removed ones vanish, vitals change health', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    enemyTick(11, { spawned: [slime(6, 2, 2)], removed: [5] }, 100, world);
    expect(world.enemyIds()).toEqual([6]);
    expect(world.enemyPositionOf(6, 100)).toEqual({ x: 2, y: 2 });
    expect(world.enemyPositionOf(5, 100)).toBeUndefined();
    expect(world.enemyTileOf(5)).toBeUndefined();
    enemyTick(12, { vitals: [{ id: 6, health: 4, maxHealth: 10 }] }, 200, world);
    expect(world.enemyInfo(6)).toEqual({ name: 'Slime', family: 'slime', health: 4, maxHealth: 10 });
  });

  it('an enemy slides like a character, through its via tiles at its speed', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 0, 0)]), 0);
    enemyTick(11, { moved: [{ ...slime(5, 1, 1), speed: 2000, via: [{ x: 1, y: 0 }] }] }, 0, world);
    expect(world.enemyTileOf(5)).toEqual({ x: 1, y: 1 });
    expect(world.enemyPositionOf(5, 0)).toEqual({ x: 0, y: 0 });
    expect(world.enemyPositionOf(5, 125)).toEqual({ x: 1, y: 0 });
    expect(world.enemyPositionOf(5, 250)).toEqual({ x: 1, y: 1 });
  });

  it('a moved enemy it does not know appears still, with its name', () => {
    const world = joined();
    enemyTick(11, { moved: [{ ...slime(8, 2, 0), via: [] }] }, 0, world);
    expect(world.enemyPositionOf(8, 0)).toEqual({ x: 2, y: 0 });
    expect(world.enemyInfo(8)?.name).toBe('Slime');
  });

  it('enemyAt finds the latest server tile, not the drawn one', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 0, 0), slime(6, 4, 0)]), 0);
    enemyTick(11, { moved: [{ ...slime(5, 2, 0), via: [] }] }, 0, world);
    expect(world.enemyAt({ x: 2, y: 0 })).toBe(5);
    expect(world.enemyAt({ x: 0, y: 0 })).toBeUndefined();
    expect(world.enemyAt({ x: 4, y: 0 })).toBe(6);
  });

  it('enemyUnderPoint picks the body as drawn mid-slide, falling back to the server tile', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 0, 0)]), 0);
    // Slides from tile (0, 0) to (1, 0) in 500 ms (speed 500 millitiles per tick); at 250 ms it is drawn at x = 0.5.
    enemyTick(11, { moved: [{ ...slime(5, 1, 0), speed: 500, via: [] }] }, 0, world);
    expect(world.enemyPositionOf(5, 250)).toEqual({ x: 0.5, y: 0 });
    // Inside the drawn square (0.65..1.35) but on tile 0, which is not its server tile: picks it.
    expect(world.enemyUnderPoint({ x: 0.7, y: 0.5 }, 250)).toBe(5);
    // On its server tile (1) but outside the drawn square (right of 1.35): falls back to the tile.
    expect(world.enemyUnderPoint({ x: 1.45, y: 0.5 }, 250)).toBe(5);
    // On neither the body nor the server tile.
    expect(world.enemyUnderPoint({ x: 0.3, y: 0.5 }, 250)).toBeUndefined();
    expect(world.enemyUnderPoint({ x: 2.5, y: 0.5 }, 250)).toBeUndefined();
    // Just above the drawn square's inset edge, off its server tile: not picked.
    expect(world.enemyUnderPoint({ x: 0.6, y: 0.5 }, 250)).toBeUndefined();
  });

  it('enemyUnderPoint prefers the drawn body over another enemy by server tile', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 0, 0), slime(6, 2, 0)]), 0);
    enemyTick(11, { moved: [{ ...slime(5, 1, 0), speed: 500, via: [] }] }, 0, world);
    // At 500 ms slime 5 is drawn on tile 1; slime 6 stands on tile 2.
    expect(world.enemyUnderPoint({ x: 1.5, y: 0.5 }, 500)).toBe(5);
    expect(world.enemyUnderPoint({ x: 2.5, y: 0.5 }, 500)).toBe(6);
  });

  it("blockerTiles lists the enemies' latest server tiles", () => {
    const world = new ClientWorld();
    expect(world.blockerTiles()).toEqual([]);
    world.applyWelcome(withEnemies([slime(5, 0, 0), slime(6, 4, 0)]), 0);
    enemyTick(11, { moved: [{ ...slime(5, 2, 0), via: [] }] }, 0, world);
    expect(world.blockerTiles()).toEqual([
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("players' health follows vitals, moved and joined entries", () => {
    const world = joined();
    world.applyTick(tick(11, { vitals: [{ id: 2, health: 12, maxHealth: 35 }] }), 0);
    expect(world.healthOf(2)).toBe(12);
    expect(world.maxHealthOf(2)).toBe(35);
    world.applyTick(tick(12, { joined: [{ id: 3, x: 1, y: 1, speed: 500, health: 20, maxHealth: 30 }] }), 0);
    expect(world.healthOf(3)).toBe(20);
    world.applyTick(tick(13, { moved: [{ id: 3, x: 2, y: 1, speed: 500, health: 18, maxHealth: 30, via: [] }] }), 0);
    expect(world.healthOf(3)).toBe(18);
    // Vitals for a stranger change nothing.
    world.applyTick(tick(14, { vitals: [{ id: 42, health: 1, maxHealth: 2 }] }), 0);
    expect(world.healthOf(42)).toBeUndefined();
    world.applyTick(tick(15, { left: [3] }), 0);
    expect(world.healthOf(3)).toBeUndefined();
  });

  it('a downed player stays where they fell, then the respawn snaps to the new tile with no slide', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, health: 30, maxHealth: 30, via: [] }] }), 0);
    world.applyTick(tick(12, { downed: [1], vitals: [{ id: 1, health: 0, maxHealth: 30 }] }), WALK_MS);
    expect(world.healthOf(1)).toBe(0);
    expect(world.positionOf(1, WALK_MS)).toEqual({ x: 2, y: 0 });
    expect(world.positionOf(1, WALK_MS * 5)).toEqual({ x: 2, y: 0 });
    world.applyTick(
      tick(13, {
        respawned: [1],
        moved: [{ id: 1, x: 1, y: 1, speed: 500, health: 30, maxHealth: 30, via: [] }],
        vitals: [{ id: 1, health: 30, maxHealth: 30 }],
      }),
      WALK_MS * 5,
    );
    expect(world.tileOf(1)).toEqual({ x: 1, y: 1 });
    expect(world.positionOf(1, WALK_MS * 5)).toEqual({ x: 1, y: 1 });
    expect(world.healthOf(1)).toBe(30);
  });

  it('a downed player has zero health even without a vitals entry', () => {
    const world = joined();
    world.applyTick(tick(11, { downed: [2] }), 0);
    expect(world.healthOf(2)).toBe(0);
  });

  it('telegraphs are replaced every tick, and cleared by an empty list', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    const next = [{ enemyId: 5, tiles: [{ x: 2, y: 0 }], kind: 'force' as const, resolvesAt: 13 }];
    world.applyTick(tick(11, { telegraphs: next }), 0);
    expect(world.telegraphs).toEqual(next);
    world.applyTick(tick(12), 0);
    expect(world.telegraphs).toEqual([]);
  });

  it("numbers appear only for your hits, at the target's drawn position, and expire after 900 ms", () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    // The enemy is mid-slide when the hits arrive: the number is placed where it is drawn.
    enemyTick(11, { moved: [{ ...slime(5, 4, 0), via: [] }] }, 1000, world);
    world.applyTick(
      tick(12, {
        hits: [
          { attacker: { side: 'player', id: 1 }, target: { side: 'enemy', id: 5 }, amount: 7 },
          { attacker: { side: 'player', id: 2 }, target: { side: 'enemy', id: 5 }, amount: 9 },
          { attacker: { side: 'enemy', id: 5 }, target: { side: 'player', id: 1 }, amount: 3 },
          { attacker: { side: 'enemy', id: 5 }, target: { side: 'player', id: 2 }, amount: 5 },
        ],
      }),
      1000 + WALK_MS / 2,
    );
    const now = 1000 + WALK_MS / 2 + 300;
    expect(world.floatingNumbers(now)).toEqual([
      { x: 3.5, y: 0, amount: 7, mine: 'dealt', age: 300 },
      { x: 0, y: 0, amount: 3, mine: 'taken', age: 300 },
    ]);
    expect(world.floatingNumbers(now + FLOAT_MS)).toEqual([]);
  });

  it('a hit that kills an enemy still gets its number, in the same tick as the removal', () => {
    const world = new ClientWorld();
    world.applyWelcome(withEnemies([slime(5, 3, 0)]), 0);
    world.applyTick(
      tick(11, {
        hits: [{ attacker: { side: 'player', id: 1 }, target: { side: 'enemy', id: 5 }, amount: 10 }],
        enemies: { spawned: [], moved: [], removed: [5], vitals: [] },
      }),
      0,
    );
    expect(world.floatingNumbers(0)).toEqual([{ x: 3, y: 0, amount: 10, mine: 'dealt', age: 0 }]);
  });

  it('a stale tick adds no numbers', () => {
    const world = joined();
    world.applyTick(tick(10, { hits: [{ attacker: { side: 'enemy', id: 5 }, target: { side: 'player', id: 1 }, amount: 3 }] }), 0);
    expect(world.floatingNumbers(0)).toEqual([]);
  });

  it('holds a sheet and a recap until replaced or dismissed', () => {
    const world = joined();
    world.applySheet(sheetMsg);
    expect(world.sheet).toEqual(sheetMsg);
    world.applyRecap(recapMsg);
    expect(world.recap).toEqual(recapMsg);
    world.dismissRecap();
    expect(world.recap).toBeNull();
  });
});

describe('parseServerMessage for combat', () => {
  it('accepts sheet and recap messages', () => {
    expect(parseServerMessage(JSON.stringify(sheetMsg))).toEqual(sheetMsg);
    expect(parseServerMessage(JSON.stringify(recapMsg))).toEqual(recapMsg);
  });
});
