import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_MESSAGE_LENGTH,
  createWorld,
  gridFromRows,
  gridToRows,
  parseClientMessage,
  queueMessage,
  step,
  tickMessage,
  viewOf,
  welcomeMessage,
} from './index';
import type { Grid, Intention, WorldState } from './index';

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
  it('copies only id, x, y and speed', () => {
    const state = walkingWorld();
    const character = state.characters[0]!;
    expect(character.path.length).toBeGreaterThan(0);
    const view = viewOf(character);
    expect(Object.keys(view).sort()).toEqual(['id', 'speed', 'x', 'y']);
    expect(view).toEqual({
      id: character.id,
      x: character.tile.x,
      y: character.tile.y,
      speed: character.speed,
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
