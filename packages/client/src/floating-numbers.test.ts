import { describe, expect, it } from 'vitest';
import type { HitView, Ref } from '@epochs/shared';
import { FLOAT_MS, addHits, visible } from './floating-numbers';
import type { FloatingNumber } from './floating-numbers';

const you = 1;
const player = (id: number): Ref => ({ side: 'player', id });
const enemy = (id: number): Ref => ({ side: 'enemy', id });
const positions = (ref: Ref) => ({ x: ref.id * 10 + (ref.side === 'enemy' ? 1 : 0), y: 5 });

describe('floating numbers', () => {
  it('lasts 900 ms', () => {
    expect(FLOAT_MS).toBe(900);
  });

  it('keeps only hits you dealt or took, placed at the target', () => {
    const hits: HitView[] = [
      { attacker: player(1), target: enemy(3), amount: 7 },
      { attacker: enemy(3), target: player(1), amount: 4 },
      { attacker: player(2), target: enemy(3), amount: 9 },
      { attacker: enemy(4), target: player(2), amount: 2 },
    ];
    const list = addHits([], hits, you, positions, 1000);
    expect(list).toEqual([
      { x: 31, y: 5, amount: 7, mine: 'dealt', bornMs: 1000 },
      { x: 10, y: 5, amount: 4, mine: 'taken', bornMs: 1000 },
    ]);
  });

  it('does not change the list it is given, and skips a target whose position is unknown', () => {
    const original: FloatingNumber[] = [];
    const next = addHits(original, [{ attacker: player(1), target: enemy(9), amount: 3 }], you, () => undefined, 0);
    expect(original).toEqual([]);
    expect(next).toEqual([]);
  });

  it('drops entries older than FLOAT_MS', () => {
    const list = addHits([], [{ attacker: player(1), target: enemy(3), amount: 7 }], you, positions, 1000);
    expect(visible(list, 1000 + FLOAT_MS - 1)).toHaveLength(1);
    expect(visible(list, 1000 + FLOAT_MS)).toHaveLength(0);
  });
});
