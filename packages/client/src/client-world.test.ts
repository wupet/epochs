import { describe, expect, it } from 'vitest';
import type { TickMessage, WelcomeMessage } from '@epochs/shared';
import { ClientWorld, parseServerMessage } from './client-world';
import { TWEEN_MS } from './motion';

const welcome: WelcomeMessage = {
  type: 'welcome',
  you: 1,
  tick: 10,
  grid: { width: 5, height: 3, rows: ['.....', '..#..', '.....'] },
  characters: [
    { id: 1, x: 0, y: 0, speed: 500 },
    { id: 2, x: 4, y: 2, speed: 500 },
  ],
};

function tick(n: number, parts: Partial<Omit<TickMessage, 'type' | 'tick'>> = {}): TickMessage {
  return { type: 'tick', tick: n, moved: [], joined: [], left: [], ...parts };
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
    world.applyWelcome({ ...welcome, you: 2, tick: 3, characters: [{ id: 2, x: 1, y: 1, speed: 500 }] }, 50);
    expect(world.you).toBe(2);
    expect(world.tick).toBe(3);
    expect(world.ids()).toEqual([2]);
    expect(world.positionOf(2, 50)).toEqual({ x: 1, y: 1 });
  });

  it('slides a moved character over one tween', () => {
    const world = joined();
    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, via: [] }] }), 1000)).toBe(true);
    expect(world.tick).toBe(11);
    expect(world.tileOf(1)).toEqual({ x: 2, y: 0 });
    expect(world.positionOf(1, 1000)).toEqual({ x: 0, y: 0 });
    expect(world.positionOf(1, 1000 + TWEEN_MS / 2)).toEqual({ x: 1, y: 0 });
    expect(world.positionOf(1, 1000 + TWEEN_MS)).toEqual({ x: 2, y: 0 });
    // The other character did not move.
    expect(world.positionOf(2, 1000 + TWEEN_MS / 2)).toEqual({ x: 4, y: 2 });
  });

  it('slides from the drawn position when a tick arrives mid-slide', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, via: [] }] }), 0);
    const mid = world.positionOf(1, TWEEN_MS / 2);
    world.applyTick(tick(12, { moved: [{ id: 1, x: 2, y: 2, speed: 500, via: [] }] }), TWEEN_MS / 2);
    expect(world.positionOf(1, TWEEN_MS / 2)).toEqual(mid);
    expect(world.positionOf(1, TWEEN_MS / 2 + TWEEN_MS)).toEqual({ x: 2, y: 2 });
  });

  it('adds joined characters still, and removes left ones', () => {
    const world = joined();
    world.applyTick(tick(11, { joined: [{ id: 3, x: 1, y: 2, speed: 500 }], left: [2] }), 500);
    expect(world.ids()).toEqual([1, 3]);
    expect(world.positionOf(3, 500)).toEqual({ x: 1, y: 2 });
    expect(world.tileOf(2)).toBeUndefined();
    expect(world.positionOf(2, 500)).toBeUndefined();
  });

  it('adds a moved character it does not know, still at its tile', () => {
    const world = joined();
    world.applyTick(tick(11, { moved: [{ id: 7, x: 3, y: 1, speed: 500, via: [] }] }), 500);
    expect(world.positionOf(7, 500)).toEqual({ x: 3, y: 1 });
    expect(world.tileOf(7)).toEqual({ x: 3, y: 1 });
  });

  it('ignores a tick at or before the current tick, and a repeated one', () => {
    const world = joined();
    const stale = tick(10, { moved: [{ id: 1, x: 3, y: 0, speed: 500, via: [] }], left: [2] });
    expect(world.applyTick(stale, 100)).toBe(false);
    expect(world.applyTick(tick(5, { left: [2] }), 100)).toBe(false);
    expect(world.tick).toBe(10);
    expect(world.tileOf(1)).toEqual({ x: 0, y: 0 });
    expect(world.ids()).toEqual([1, 2]);

    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 1, y: 0, speed: 500, via: [] }] }), 200)).toBe(true);
    expect(world.applyTick(tick(11, { moved: [{ id: 1, x: 2, y: 0, speed: 500, via: [] }] }), 210)).toBe(false);
    expect(world.tileOf(1)).toEqual({ x: 1, y: 0 });
    expect(world.tick).toBe(11);
  });

  it('settles on the last tile after 40 ticks applied at the same instant', () => {
    const world = joined();
    for (let i = 1; i <= 40; i++) {
      expect(world.applyTick(tick(10 + i, { moved: [{ id: 1, x: i % 5, y: 1, speed: 500, via: [] }] }), 7000)).toBe(true);
    }
    expect(world.tileOf(1)).toEqual({ x: 0, y: 1 });
    expect(world.positionOf(1, 7000 + TWEEN_MS)).toEqual({ x: 0, y: 1 });
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

  it('accepts a welcome or a tick', () => {
    expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
    const t = tick(11);
    expect(parseServerMessage(JSON.stringify(t))).toEqual(t);
  });
});
