import { describe, expect, it } from 'vitest';
import { createWorld, gridFromRows, step } from './index';
import type { Intention, WorldState } from './index';

const GRID_ROWS = [
  '............',
  '.######.....',
  '.#....#.....',
  '.#....#..##.',
  '.#.####..#..',
  '.#.......##.',
  '.####.###...',
  '............',
  '..#.....#...',
  '..#..##.#...',
  '.....#......',
  '............',
];

/** Sixty ticks of scripted intentions: joins, moves (some to blocked tiles), a re-route, a leave. */
function script(): Intention[][] {
  const ticks: Intention[][] = Array.from({ length: 60 }, () => []);
  ticks[0] = [
    { kind: 'join', characterId: 1, subtick: 0 },
    { kind: 'join', characterId: 2, subtick: 0 },
    { kind: 'move', characterId: 1, target: { x: 10, y: 10 }, subtick: 0 },
  ];
  ticks[1] = [
    { kind: 'move', characterId: 2, target: { x: 3, y: 3 }, subtick: 0 }, // walled-in room
    { kind: 'move', characterId: 2, target: { x: 6, y: 1 }, subtick: 0 }, // blocked tile; the last one counts
  ];
  ticks[3] = [{ kind: 'join', characterId: 3, subtick: 0 }];
  ticks[4] = [
    { kind: 'move', characterId: 3, target: { x: 0, y: 11 }, subtick: 0 },
    { kind: 'move', characterId: 2, target: { x: 11, y: 0 }, subtick: 0 },
  ];
  ticks[8] = [{ kind: 'move', characterId: 1, target: { x: 11, y: 11 }, subtick: 0 }]; // re-route mid-walk
  ticks[12] = [{ kind: 'move', characterId: 3, target: { x: 9, y: 3 }, subtick: 0 }]; // blocked target
  ticks[20] = [
    { kind: 'move', characterId: 1, target: { x: 0, y: 0 }, subtick: 3 },
    { kind: 'move', characterId: 2, target: { x: 0, y: 0 }, subtick: 3 },
  ];
  ticks[30] = [{ kind: 'leave', characterId: 2, subtick: 0 }];
  ticks[31] = [{ kind: 'move', characterId: 2, target: { x: 5, y: 5 }, subtick: 0 }]; // unknown by now
  ticks[40] = [{ kind: 'move', characterId: 3, target: { x: 6, y: 7 }, subtick: 0 }];
  return ticks;
}

function run(): WorldState[] {
  let world = createWorld(gridFromRows(GRID_ROWS), { x: 0, y: 0 });
  const states: WorldState[] = [world];
  for (const intentions of script()) {
    world = step(world, intentions);
    states.push(world);
  }
  return states;
}

describe('determinism', () => {
  it('the same intentions from the same start give the same states, every tick', () => {
    const first = run();
    const second = run();
    expect(first).toHaveLength(61);
    expect(second).toEqual(first);
    expect(JSON.stringify(second[second.length - 1])).toBe(JSON.stringify(first[first.length - 1]));
  });

  it('the script actually does something', () => {
    const states = run();
    const final = states[states.length - 1]!;
    expect(final.tick).toBe(60);
    expect(final.characters.map((c) => c.id)).toEqual([1, 3]);
    expect(states.some((s) => s.characters.some((c) => c.path.length > 0))).toBe(true);
  });
});
