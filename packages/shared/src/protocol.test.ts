import { describe, expect, it } from 'vitest';
import {
  MAX_CLIENT_MESSAGE_LENGTH,
  createWorld,
  gridFromRows,
  gridToRows,
  parseClientMessage,
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
  it('copies only id, x and y', () => {
    const state = walkingWorld();
    const character = state.characters[0]!;
    expect(character.path.length).toBeGreaterThan(0);
    const view = viewOf(character);
    expect(Object.keys(view).sort()).toEqual(['id', 'x', 'y']);
    expect(view).toEqual({ id: character.id, x: character.tile.x, y: character.tile.y });
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

  it('never contains a path, even when a character has one', () => {
    const state = walkingWorld();
    expect(state.characters[0]!.path.length).toBeGreaterThan(0);
    const text = JSON.stringify(welcomeMessage(state, 1));
    expect(text).not.toContain('"path"');
    expect(text).not.toContain('"tile"');
  });
});

describe('tickMessage', () => {
  it('reports joins, leaves and moves across one step, sorted by id', () => {
    const base = step(createWorld(open(8, 8), { x: 0, y: 0 }), [join(1), join(2), join(3)]);
    const moving = step(base, [move(3, 5, 5), move(1, 5, 0)]);
    const next = step(moving, [leave(2), join(9), join(4)]);
    const msg = tickMessage(moving, next);
    expect(msg.type).toBe('tick');
    expect(msg.tick).toBe(next.tick);
    expect(msg.joined.map((c) => c.id)).toEqual([4, 9]);
    expect(msg.left).toEqual([2]);
    expect(msg.moved.map((c) => c.id)).toEqual([1, 3]);
    const nextOne = next.characters.find((c) => c.id === 1)!;
    expect(msg.moved[0]).toEqual({ id: 1, x: nextOne.tile.x, y: nextOne.tile.y });
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

  it('never contains a path', () => {
    const prev = walkingWorld();
    const next = step(prev, []);
    expect(next.characters[0]!.path.length).toBeGreaterThan(0);
    const msg = tickMessage(prev, next);
    expect(msg.moved.length).toBe(1);
    const text = JSON.stringify(msg);
    expect(text).not.toContain('"path"');
    expect(text).not.toContain('"tile"');
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
  ])('rejects %s', (_name, raw) => {
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
