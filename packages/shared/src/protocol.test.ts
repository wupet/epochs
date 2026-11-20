import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_MESSAGE_LENGTH,
  attributesOf,
  createArenaWorld,
  createWorld,
  debugCatalog,
  maxHealthOf,
  recapMessage,
  sheetMessage,
  gridFromRows,
  fullMessage,
  gridToRows,
  parseClientMessage,
  queueMessage,
  step,
  tickMessage,
  viewOf,
  welcomeMessage,
} from './index';
import type { Grid, Intention, ServerMessage, WorldState } from './index';
import { content } from './test-support/arena';
import { COMBAT_SCRIPT_TICKS, runCombatScript } from './test-support/combat-script';

function open(width: number, height: number): Grid {
  return gridFromRows(Array.from({ length: height }, () => '.'.repeat(width)));
}

const join = (characterId: number): Intention => ({ kind: 'join', characterId, subtick: 0 });
const leave = (characterId: number): Intention => ({ kind: 'leave', characterId, subtick: 0 });
const mode = (characterId: number, m: 'walk' | 'run' | 'horse'): Intention => ({
  kind: 'mode',
  characterId,
  mode: m,
  subtick: 0,
});
const move = (characterId: number, x: number, y: number): Intention => ({
  kind: 'move',
  characterId,
  target: { x, y },
  subtick: 0,
});

/** Two characters, with character 1 walking (so it has a non-empty path). */
function walkingWorld(): WorldState {
  const world = createWorld(open(8, 8), { x: 0, y: 0 });
  const joined = step(world, [join(1), join(2)]);
  return step(joined, [move(1, 6, 6)]);
}

describe('viewOf', () => {
  it('copies only id, x, y, speed, health and maxHealth', () => {
    const state = walkingWorld();
    const character = state.characters[0]!;
    expect(character.path.length).toBeGreaterThan(0);
    const view = viewOf(character, state.content);
    expect(Object.keys(view).sort()).toEqual(['health', 'id', 'maxHealth', 'speed', 'x', 'y']);
    expect(view).toEqual({
      id: character.id,
      x: character.tile.x,
      y: character.tile.y,
      speed: character.speed,
      health: character.health,
      maxHealth: maxHealthOf(character.sheet, state.content),
    });
  });
});

describe('welcomeMessage', () => {
  it('carries the grid rows, the tick, the viewer and every character sorted by id', () => {
    const grid = gridFromRows(['..#.', '....', '.#..']);
    const state = step(createWorld(grid, { x: 0, y: 0 }), [join(5), join(2)]);
    const msg = welcomeMessage(state, 5);
    expect(msg.type).toBe('welcome');
    expect(msg.you).toBe(5);
    expect(msg.tick).toBe(state.tick);
    expect(msg.grid).toEqual({ width: 4, height: 3, rows: gridToRows(state.grid) });
    expect(msg.characters.map((c) => c.id)).toEqual([2, 5]);
  });

  it('never contains a path, progress or stepped, even when a character has them', () => {
    const state = walkingWorld();
    expect(state.characters[0]!.path.length).toBeGreaterThan(0);
    const text = JSON.stringify(welcomeMessage(state, 1));
    expect(text).not.toContain('"path"');
    expect(text).not.toContain('"progress"');
    expect(text).not.toContain('"stepped"');
    expect(text).not.toContain('"tile"');
    expect(text).toContain('"speed"');
  });
});

describe('tickMessage', () => {
  it('reports joins, leaves and moves across one step, sorted by id', () => {
    const base = step(createWorld(open(8, 8), { x: 0, y: 0 }), [join(1), join(2), join(3)]);
    // Walkers step every second tick, so let one rest tick pass: the next tick has them step again.
    const moving = step(step(base, [move(3, 5, 5), move(1, 5, 0)]), []);
    const next = step(moving, [leave(2), join(9), join(4)]);
    const msg = tickMessage(moving, next);
    expect(msg.type).toBe('tick');
    expect(msg.tick).toBe(next.tick);
    expect(msg.joined.map((c) => c.id)).toEqual([4, 9]);
    expect(msg.left).toEqual([2]);
    expect(msg.moved.map((c) => c.id)).toEqual([1, 3]);
    const nextOne = next.characters.find((c) => c.id === 1)!;
    expect(msg.moved[0]).toEqual({
      id: 1,
      x: nextOne.tile.x,
      y: nextOne.tile.y,
      speed: nextOne.speed,
      health: nextOne.health,
      maxHealth: maxHealthOf(nextOne.sheet, next.content),
      via: [],
    });
  });

  it('gives a horse that steps twice a via of the first tile it passed through', () => {
    const base = step(createWorld(open(10, 4), { x: 0, y: 0 }), [join(1)]);
    const prev = step(base, [mode(1, 'horse'), move(1, 8, 0)]);
    const next = step(prev, []);
    const character = next.characters[0]!;
    expect(character.stepped.length).toBe(2);
    const msg = tickMessage(prev, next);
    expect(msg.moved).toHaveLength(1);
    const entry = msg.moved[0]!;
    expect(entry.via).toHaveLength(1);
    expect(entry.via[0]).toEqual({ x: character.stepped[0]!.x, y: character.stepped[0]!.y });
    expect(Object.keys(entry.via[0]!).sort()).toEqual(['x', 'y']);
    expect({ x: entry.x, y: entry.y }).toEqual(character.tile);
    expect(entry.speed).toBe(2000);
  });

  it('gives an empty via when a character steps once', () => {
    const base = step(createWorld(open(10, 4), { x: 0, y: 0 }), [join(1)]);
    const prev = step(base, [mode(1, 'run'), move(1, 8, 0)]);
    const next = step(prev, []);
    expect(next.characters[0]!.stepped.length).toBe(1);
    const msg = tickMessage(prev, next);
    expect(msg.moved).toHaveLength(1);
    expect(msg.moved[0]!.via).toEqual([]);
  });

  it('returns empty arrays when nothing changed', () => {
    const state = step(createWorld(open(4, 4), { x: 0, y: 0 }), [join(1)]);
    const next = step(state, []);
    const msg = tickMessage(state, next);
    expect(msg.tick).toBe(state.tick + 1);
    expect(msg.moved).toEqual([]);
    expect(msg.joined).toEqual([]);
    expect(msg.left).toEqual([]);
  });

  it('never contains a path, progress or stepped', () => {
    const prev = step(walkingWorld(), []); // a walker's rest tick; it steps on the next one
    const next = step(prev, []);
    expect(next.characters[0]!.path.length).toBeGreaterThan(0);
    const msg = tickMessage(prev, next);
    expect(msg.moved.length).toBe(1);
    const text = JSON.stringify(msg);
    expect(text).not.toContain('"path"');
    expect(text).not.toContain('"progress"');
    expect(text).not.toContain('"stepped"');
    expect(text).not.toContain('"tile"');
  });
});

describe('queueMessage', () => {
  it('carries the position in the queue', () => {
    expect(queueMessage(3)).toEqual({ type: 'queue', position: 3 });
  });
});

describe('fullMessage', () => {
  it('says only that the server is full', () => {
    expect(fullMessage()).toEqual({ type: 'full' });
  });
});

describe('parseClientMessage', () => {
  const grid = gridFromRows(['....', '.#..', '....']);

  it('accepts a valid move', () => {
    expect(parseClientMessage('{"type":"move","x":3,"y":2}', grid)).toEqual({
      type: 'move',
      x: 3,
      y: 2,
    });
  });

  it('accepts a blocked in-bounds tile', () => {
    expect(parseClientMessage('{"type":"move","x":1,"y":1}', grid)).toEqual({
      type: 'move',
      x: 1,
      y: 1,
    });
  });

  it('returns a fresh object, not the parsed input', () => {
    const msg = parseClientMessage('{"y":0,"x":0,"type":"move"}', grid);
    expect(msg).toEqual({ type: 'move', x: 0, y: 0 });
    expect(Object.keys(msg!)).toEqual(['type', 'x', 'y']);
  });

  it.each([
    ['not valid JSON', 'not json'],
    ['null', 'null'],
    ['an array', '[]'],
    ['a number', '5'],
    ['a string', '"move"'],
    ['a fractional x', '{"type":"move","x":1.5,"y":2}'],
    ['a fractional y', '{"type":"move","x":1,"y":0.5}'],
    ['x below zero', '{"type":"move","x":-1,"y":0}'],
    ['y below zero', '{"type":"move","x":0,"y":-1}'],
    ['x equal to width', '{"type":"move","x":4,"y":0}'],
    ['y equal to height', '{"type":"move","x":0,"y":3}'],
    ['x as a string', '{"type":"move","x":"3","y":0}'],
    ['x missing', '{"type":"move","y":0}'],
    ['an extra key', '{"type":"move","x":1,"y":1,"path":[]}'],
    ['an unknown type', '{"type":"attack","x":1,"y":1}'],
    ['a missing type', '{"x":1,"y":1,"z":2}'],
    ['an x too large for a number', '{"type":"move","x":1e400,"y":0}'],
    ['an own __proto__ key', '{"type":"move","x":1,"y":2,"__proto__":{}}'],
  ])('rejects %s', (_name, raw) => {
    expect(parseClientMessage(raw, grid)).toBeNull();
  });

  it.each(['walk', 'run', 'horse'])('accepts a debug mode message for %s', (m) => {
    expect(parseClientMessage(`{"type":"mode","mode":"${m}"}`, grid)).toEqual({ type: 'mode', mode: m });
  });

  it('returns a fresh object for a mode message', () => {
    const msg = parseClientMessage('{"mode":"run","type":"mode"}', grid);
    expect(Object.keys(msg!)).toEqual(['type', 'mode']);
  });

  it.each([
    ['an unknown mode', '{"type":"mode","mode":"fly"}'],
    ['an inherited key as the mode', '{"type":"mode","mode":"toString"}'],
    ['a non-string mode', '{"type":"mode","mode":1}'],
    ['an extra key', '{"type":"mode","mode":"run","x":1}'],
    ['a missing mode', '{"type":"mode"}'],
    ['a mode on a move', '{"type":"move","x":1,"y":1,"mode":"run"}'],
  ])('rejects a mode message with %s', (_name, raw) => {
    expect(parseClientMessage(raw, grid)).toBeNull();
  });

  it('rejects a message longer than the limit', () => {
    const raw = `{"type":"move","x":1,"y":1,"pad":"${'a'.repeat(300)}"}`;
    expect(raw.length).toBeGreaterThan(MAX_CLIENT_MESSAGE_LENGTH);
    expect(parseClientMessage(raw, grid)).toBeNull();
    // Even whitespace padding around an otherwise valid message is too long.
    const padded = '{"type":"move","x":1,"y":1}' + ' '.repeat(300);
    expect(parseClientMessage(padded, grid)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Combat: health, enemies, telegraphs, hits, the sheet, the recap, the catalog and the new messages.
// ---------------------------------------------------------------------------------------------

const wideGrid = gridFromRows(Array.from({ length: 24 }, () => '.'.repeat(24)));

/** Every key anywhere in a message, however deep. */
function keysIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysIn(v, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysIn(v, into);
    }
  }
  return into;
}

const HIDDEN_KEYS = [
  'resistances',
  'lastDamagedBy',
  'lastHitTick',
  'order',
  'recentHits',
  'rng',
  'path',
  'progress',
  'stepped',
  'readyTick',
  'nextAttackTick',
  'respawnTick',
  'tile',
  'sheet',
  'windup',
];

describe('combat views', () => {
  const states = runCombatScript(7);
  const messages = states.slice(1).map((next, i) => tickMessage(states[i]!, next));

  it('gives enemy views with name, family and health from the content', () => {
    const prev = step(createArenaWorld(content, 'arena', 7), [join(1)]);
    const next = step(prev, [{ kind: 'debug-start-wave', characterId: 1, waveId: 'practice', subtick: 0 }]);
    const msg = tickMessage(prev, next);
    // The dummy and the slime are new this tick, shown where they stand at the end of it.
    expect(msg.enemies.spawned.map((e) => e.id)).toEqual([1, 2]);
    expect(msg.enemies.moved).toEqual([]);
    expect(msg.enemies.spawned).toEqual(
      next.enemies.map((e) => ({
        id: e.id,
        x: e.tile.x,
        y: e.tile.y,
        speed: e.speed,
        name: e.contentId === 'slime' ? 'Slime' : 'Training Dummy',
        family: e.contentId === 'slime' ? 'slime' : 'construct',
        health: e.health,
        maxHealth: e.contentId === 'slime' ? 12 : 1000,
      })),
    );
    const slime = msg.enemies.spawned[1]!;
    expect(Object.keys(slime).sort()).toEqual(['family', 'health', 'id', 'maxHealth', 'name', 'speed', 'x', 'y']);
  });

  it('lists the enemies a clear removed, and nothing as spawned', () => {
    const base = step(createArenaWorld(content, 'arena', 7), [join(1)]);
    const withWave = step(base, [{ kind: 'debug-start-wave', characterId: 1, waveId: 'practice', subtick: 0 }]);
    const cleared = step(withWave, [{ kind: 'debug-clear-enemies', characterId: 1, subtick: 0 }]);
    const msg = tickMessage(withWave, cleared);
    expect(msg.enemies.removed).toEqual([1, 2]);
    expect(msg.enemies.spawned).toEqual([]);
  });

  it('describes the welcome after a scripted fight: campfire, enemies, telegraphs, catalog', () => {
    const state = states[states.length - 1]!;
    const msg = welcomeMessage(state, 1);
    expect(msg.campfire).toEqual(state.campfire);
    expect(msg.campfire).not.toBeNull();
    expect(msg.enemies.map((e) => e.id)).toEqual(state.enemies.map((e) => e.id).sort((a, b) => a - b));
    expect(msg.catalog).toEqual(debugCatalog(content));
    expect(msg.characters.every((c) => c.maxHealth > 0)).toBe(true);
  });

  it('puts every active telegraph in the welcome and in each tick, landing on windup.resolvesAt + 1', () => {
    let seen = 0;
    for (let i = 1; i < states.length; i++) {
      const state = states[i]!;
      const windups = state.enemies.filter((e) => e.windup !== null);
      const msg = tickMessage(states[i - 1]!, state);
      expect(msg.telegraphs.map((t) => t.enemyId)).toEqual(windups.map((e) => e.id));
      for (const t of msg.telegraphs) {
        const enemy = windups.find((e) => e.id === t.enemyId)!;
        expect(t.resolvesAt).toBe(enemy.windup!.resolvesAt + 1);
        expect(t.resolvesAt).toBeGreaterThanOrEqual(msg.tick);
        expect(t.tiles).toEqual(enemy.windup!.tiles.map((x) => ({ x: x.x, y: x.y })));
        expect(t.kind).toBe('force');
        expect(Object.keys(t).sort()).toEqual(['enemyId', 'kind', 'resolvesAt', 'tiles']);
        seen++;
      }
      expect(welcomeMessage(state, 1).telegraphs).toEqual(msg.telegraphs);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('reports hits as { attacker, target, amount } only, in event order', () => {
    let seen = 0;
    for (let i = 1; i < states.length; i++) {
      const msg = tickMessage(states[i - 1]!, states[i]!);
      expect(msg.hits).toEqual(
        states[i]!.hits.map((h) => ({
          attacker: { side: h.attacker.side, id: h.attacker.id },
          target: { side: h.target.side, id: h.target.id },
          amount: h.amount,
        })),
      );
      for (const h of msg.hits) {
        expect(Object.keys(h).sort()).toEqual(['amount', 'attacker', 'target']);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('reports health changes as vitals for characters and for enemies, sorted by id', () => {
    expect(messages.some((m) => m.vitals.length > 0)).toBe(true);
    expect(messages.some((m) => m.enemies.vitals.length > 0)).toBe(true);
    for (let i = 1; i < states.length; i++) {
      const msg = messages[i - 1]!;
      for (const v of msg.vitals) {
        const c = states[i]!.characters.find((x) => x.id === v.id)!;
        expect(v).toEqual({ id: c.id, health: c.health, maxHealth: maxHealthOf(c.sheet, content) });
      }
      const ids = msg.vitals.map((v) => v.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      for (const v of msg.enemies.vitals) {
        const e = states[i]!.enemies.find((x) => x.id === v.id)!;
        expect(v.health).toBe(e.health);
      }
    }
  });

  it('shows a downed player at 0 health where they fell, then respawned and moved with an empty via', () => {
    const at = messages.findIndex((m) => m.downed.length > 0);
    expect(at).toBeGreaterThanOrEqual(0);
    const down = messages[at]!;
    const state = states[at + 1]!;
    const fallen = down.downed[0]!;
    const body = state.characters.find((c) => c.id === fallen)!;
    expect(body.respawnTick).not.toBeNull();
    const welcome = welcomeMessage(state, fallen);
    expect(welcome.characters.find((c) => c.id === fallen)).toMatchObject({ x: body.tile.x, y: body.tile.y, health: 0 });
    expect(down.vitals.find((v) => v.id === fallen)?.health).toBe(0);
    expect(down.respawned).not.toContain(fallen);

    const up = messages[at + 1]!;
    expect(up.respawned).toContain(fallen);
    const entry = up.moved.find((m) => m.id === fallen)!;
    expect(entry).toBeDefined();
    expect(entry.via).toEqual([]);
    expect(entry.health).toBe(entry.maxHealth);
    expect(up.vitals.find((v) => v.id === fallen)?.health).toBe(entry.maxHealth);
    expect(up.downed).not.toContain(fallen);
  });

  it('lists a respawned player in moved even if they get up on the tile they fell on', () => {
    const world = step(createArenaWorld(content, 'arena', 7), [join(1)]);
    const spawnTile = world.characters[0]!.tile;
    const prev: WorldState = {
      ...world,
      characters: world.characters.map((c) => ({ ...c, health: 0, respawnTick: world.tick })),
    };
    const next = step(prev, []);
    expect(next.respawned).toEqual([1]);
    expect(next.characters[0]!.tile).toEqual(spawnTile);
    const msg = tickMessage(prev, next);
    expect(msg.respawned).toEqual([1]);
    expect(msg.moved.map((m) => m.id)).toEqual([1]);
    expect(msg.moved[0]!.via).toEqual([]);
  });

  it('has no hidden key anywhere in any welcome, tick, sheet or recap message of the combat script', () => {
    expect(states.length).toBe(COMBAT_SCRIPT_TICKS + 1);
    const everything: ServerMessage[] = [];
    let recaps = 0;
    for (let i = 0; i < states.length; i++) {
      const state = states[i]!;
      for (const c of state.characters) {
        everything.push(welcomeMessage(state, c.id));
        const sheet = sheetMessage(state, c.id);
        expect(sheet).not.toBeNull();
        everything.push(sheet!);
      }
      for (const recap of state.recaps) {
        everything.push(recapMessage(recap));
        recaps++;
      }
      if (i > 0) everything.push(tickMessage(states[i - 1]!, state));
    }
    expect(recaps).toBeGreaterThan(0);
    for (const message of everything) {
      const found = keysIn(JSON.parse(JSON.stringify(message)));
      for (const key of HIDDEN_KEYS) expect(found.has(key), `${message.type} has "${key}"`).toBe(false);
    }
  });
});

describe('sheetMessage', () => {
  const state = step(createArenaWorld(content, 'arena', 7), [join(1)]);

  it('carries the sheet, the derived attributes and the max health', () => {
    const character = state.characters[0]!;
    const msg = sheetMessage(state, 1)!;
    expect(msg).toEqual({
      type: 'sheet',
      presetId: character.sheet.presetId,
      level: 1,
      attributes: attributesOf(character.sheet, content),
      levelPoints: character.sheet.levelPoints,
      weaponId: character.sheet.weaponId,
      armorId: character.sheet.armorId,
      classRanks: character.sheet.classRanks,
      maxHealth: maxHealthOf(character.sheet, content),
    });
    expect(msg.levelPoints).not.toBe(character.sheet.levelPoints);
    expect(msg.classRanks).not.toBe(character.sheet.classRanks);
  });

  it('is null for a character that is not in the world', () => {
    expect(sheetMessage(state, 99)).toBeNull();
  });
});

describe('recapMessage', () => {
  it('carries the tick and each hit with names and the telegraph, and nothing else', () => {
    const msg = recapMessage({
      characterId: 4,
      tick: 31,
      hits: [
        {
          tick: 30,
          attacker: { side: 'enemy', id: 2 },
          target: { side: 'player', id: 4 },
          amount: 3,
          attackerName: 'Slime',
          attackName: 'Touch',
          telegraph: { name: 'Touch', windupTicks: 1 },
        },
        {
          tick: 31,
          attacker: { side: 'enemy', id: 3 },
          target: { side: 'player', id: 4 },
          amount: 2,
          attackerName: 'Slime',
          attackName: 'Bump',
          telegraph: null,
        },
      ],
    });
    expect(msg).toEqual({
      type: 'recap',
      tick: 31,
      hits: [
        { tick: 30, attacker: 'Slime', attack: 'Touch', amount: 3, telegraph: { name: 'Touch', windupTicks: 1 } },
        { tick: 31, attacker: 'Slime', attack: 'Bump', amount: 2, telegraph: null },
      ],
    });
  });
});

describe('debugCatalog', () => {
  it('lists presets, weapons (with range), armors, classes and waves sorted by id, with the top level and rank', () => {
    const catalog = debugCatalog(content);
    expect(catalog.maxLevel).toBe(10);
    expect(catalog.maxClassRank).toBe(3);
    for (const list of [catalog.presets, catalog.weapons, catalog.armors, catalog.classes, catalog.waves]) {
      const ids = list.map((e) => e.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toEqual([...ids].sort());
    }
    expect(catalog.weapons.map((w) => w.id)).toEqual(['cudgel', 'hunting-bow', 'rusty-shortsword', 'witchs-staff']);
    expect(catalog.weapons.find((w) => w.id === 'hunting-bow')).toEqual({ id: 'hunting-bow', name: 'Hunting Bow', rangeTiles: 6 });
    expect(catalog.armors).toEqual([{ id: 'leather-jerkin', name: 'Leather Jerkin' }]);
    expect(catalog.waves.map((w) => w.id)).toEqual(['practice', 'wave-1']);
    expect(Object.keys(catalog.presets[0]!).sort()).toEqual(['id', 'mainAttribute', 'name']);
    expect(catalog.presets.find((p) => p.id === 'hedge-witch')?.mainAttribute).toBe('wits');
  });
});

describe('parseClientMessage for combat', () => {
  const grid = wideGrid;
  const parse = (value: unknown): unknown => parseClientMessage(JSON.stringify(value), grid);

  it.each([
    [{ type: 'attack', enemyId: 3 }],
    [{ type: 'attack-move', x: 5, y: 6 }],
    [{ type: 'debug-preset', presetId: 'hunter' }],
    [{ type: 'debug-level', level: 10 }],
    [{ type: 'debug-level', level: 1 }],
    [{ type: 'debug-move-point', from: 'might', to: 'spirit' }],
    [{ type: 'debug-weapon', itemId: 'cudgel' }],
    [{ type: 'debug-weapon', itemId: null }],
    [{ type: 'debug-armor', itemId: 'leather-jerkin' }],
    [{ type: 'debug-armor', itemId: null }],
    [{ type: 'debug-class-rank', classId: 'militia', rank: 3 }],
    [{ type: 'debug-heal' }],
    [{ type: 'debug-start-wave', waveId: 'wave-1' }],
    [{ type: 'debug-start-wave', waveId: 'constructor' }],
    [{ type: 'debug-clear-enemies' }],
  ])('accepts %j and returns an equal fresh object', (message) => {
    expect(parse(message)).toEqual(message);
  });

  it('accepts an id of exactly 64 characters', () => {
    const id = 'a'.repeat(64);
    expect(parse({ type: 'debug-preset', presetId: id })).toEqual({ type: 'debug-preset', presetId: id });
  });

  it.each([
    ['an extra key on attack', { type: 'attack', enemyId: 3, x: 1 }],
    ['an extra key on a debug heal', { type: 'debug-heal', level: 3 }],
    ['an extra key on a debug level', { type: 'debug-level', level: 3, presetId: 'hunter' }],
    ['a missing key on attack-move', { type: 'attack-move', x: 1 }],
    ['level 11', { type: 'debug-level', level: 11 }],
    ['level 0', { type: 'debug-level', level: 0 }],
    ['a fractional level', { type: 'debug-level', level: 2.5 }],
    ['a string level', { type: 'debug-level', level: '3' }],
    ['rank 0', { type: 'debug-class-rank', classId: 'militia', rank: 0 }],
    ['rank 4', { type: 'debug-class-rank', classId: 'militia', rank: 4 }],
    ['enemyId 1.5', { type: 'attack', enemyId: 1.5 }],
    ['enemyId 0', { type: 'attack', enemyId: 0 }],
    ['enemyId -2', { type: 'attack', enemyId: -2 }],
    ['a string enemyId', { type: 'attack', enemyId: '3' }],
    ['waveId "Wave 1"', { type: 'debug-start-wave', waveId: 'Wave 1' }],
    ['an empty id', { type: 'debug-preset', presetId: '' }],
    ['a 65-character id', { type: 'debug-preset', presetId: 'a'.repeat(65) }],
    ['a non-string id', { type: 'debug-start-wave', waveId: 5 }],
    ['a null preset', { type: 'debug-preset', presetId: null }],
    ['a bad item id', { type: 'debug-weapon', itemId: 'Rusty Sword' }],
    ['a missing item id', { type: 'debug-weapon' }],
    ['an unknown attribute', { type: 'debug-move-point', from: 'luck', to: 'might' }],
    ['an inherited attribute name', { type: 'debug-move-point', from: 'constructor', to: 'might' }],
    ['an attack-move out of the grid', { type: 'attack-move', x: 24, y: 0 }],
    ['a fractional attack-move', { type: 'attack-move', x: 1.5, y: 0 }],
    ['an inherited type name', { type: 'constructor' }],
    ['an unknown debug type', { type: 'debug-win' }],
    ['a non-string type', { type: 5 }],
  ])('rejects %s', (_name, message) => {
    expect(parse(message)).toBeNull();
  });

  it('rejects an own __proto__ key on a combat message', () => {
    expect(parseClientMessage('{"type":"attack","enemyId":1,"__proto__":{}}', grid)).toBeNull();
  });

  it('returns fresh objects with the keys in a fixed order', () => {
    expect(Object.keys(parseClientMessage('{"y":1,"x":2,"type":"attack-move"}', grid)!)).toEqual(['type', 'x', 'y']);
    expect(Object.keys(parseClientMessage('{"rank":2,"classId":"militia","type":"debug-class-rank"}', grid)!)).toEqual([
      'type',
      'classId',
      'rank',
    ]);
  });
});
