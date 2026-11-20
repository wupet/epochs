import { describe, expect, it } from 'vitest';
import { createWorld, gridFromRows, step } from './index';
import type { Intention, WorldState } from './index';
import { SCRIPT_SLIME, SCRIPT_WAVE_1_IDS, runCombatScript } from './test-support/combat-script';

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

/**
 * Sixty ticks of scripted intentions: joins, moves (some to blocked tiles), a re-route, debug mode
 * changes (walk, run, horse), a leave.
 */
function script(): Intention[][] {
  const ticks: Intention[][] = Array.from({ length: 60 }, () => []);
  ticks[0] = [
    { kind: 'join', characterId: 1, subtick: 0 },
    { kind: 'join', characterId: 2, subtick: 0 },
    { kind: 'move', characterId: 1, target: { x: 10, y: 10 }, subtick: 0 },
  ];
  ticks[1] = [
    { kind: 'move', characterId: 2, target: { x: 3, y: 3 }, subtick: 0 }, // a room that is open at the bottom; replaced by the next move
    { kind: 'move', characterId: 2, target: { x: 6, y: 1 }, subtick: 0 }, // blocked tile; the last move this tick wins
  ];
  ticks[3] = [{ kind: 'join', characterId: 3, subtick: 0 }];
  ticks[4] = [
    { kind: 'move', characterId: 3, target: { x: 0, y: 11 }, subtick: 0 },
    { kind: 'move', characterId: 2, target: { x: 11, y: 0 }, subtick: 0 },
  ];
  ticks[6] = [{ kind: 'mode', characterId: 1, mode: 'run', subtick: 0 }];
  ticks[8] = [{ kind: 'move', characterId: 1, target: { x: 11, y: 11 }, subtick: 0 }]; // re-route mid-walk
  ticks[10] = [{ kind: 'mode', characterId: 2, mode: 'horse', subtick: 0 }];
  ticks[12] = [{ kind: 'move', characterId: 3, target: { x: 9, y: 3 }, subtick: 0 }]; // blocked target
  ticks[20] = [
    { kind: 'move', characterId: 1, target: { x: 0, y: 0 }, subtick: 3 },
    { kind: 'move', characterId: 2, target: { x: 0, y: 0 }, subtick: 3 },
  ];
  ticks[24] = [
    { kind: 'mode', characterId: 1, mode: 'walk', subtick: 2 },
    { kind: 'mode', characterId: 3, mode: 'horse', subtick: 0 },
  ];
  ticks[30] = [{ kind: 'leave', characterId: 2, subtick: 0 }];
  ticks[31] = [{ kind: 'move', characterId: 2, target: { x: 5, y: 5 }, subtick: 0 }]; // unknown by now
  ticks[36] = [{ kind: 'mode', characterId: 3, mode: 'run', subtick: 0 }];
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
    // The mode changes took effect, and the faster modes moved a character two tiles in one tick.
    const speeds = new Set(states.flatMap((s) => s.characters.map((c) => c.speed)));
    expect([...speeds].sort((a, b) => a - b)).toEqual([500, 1000, 2000]);
    expect(states.some((s) => s.characters.some((c) => c.stepped.length === 2))).toBe(true);
  });
});

describe('determinism in combat', () => {
  it('the same combat script on the same seed gives JSON-equal states', () => {
    const first = runCombatScript(12345);
    const second = runCombatScript(12345);
    expect(JSON.stringify(second[second.length - 1])).toBe(JSON.stringify(first[first.length - 1]));
    expect(second).toEqual(first);
  });

  it('the combat script does everything it claims to', () => {
    const states = runCombatScript(12345);
    const hits = states.flatMap((s) => s.hits);
    // The practice wave, then wave 1.
    expect(states.some((s) => s.enemies.some((e) => e.contentId === 'training-dummy'))).toBe(true);
    expect(states.some((s) => SCRIPT_WAVE_1_IDS.every((id) => s.enemies.some((e) => e.id === id)))).toBe(true);
    // Players hit the dummy and the slime; slimes hit players through a telegraph.
    expect(hits.some((h) => h.attacker.side === 'player' && h.target.id === 1 && h.target.side === 'enemy')).toBe(true);
    expect(hits.some((h) => h.attacker.side === 'player' && h.target.id === SCRIPT_SLIME)).toBe(true);
    expect(hits.some((h) => h.attacker.side === 'enemy' && h.telegraph !== null)).toBe(true);
    // An attack-move locked onto an enemy.
    expect(
      states.some((s) => s.characters.some((c) => c.order.kind === 'attack-move' && c.order.lockedOn !== null)),
    ).toBe(true);
    // A player went down, got a recap, and respawned.
    expect(states.some((s) => s.downed.length > 0)).toBe(true);
    expect(states.some((s) => s.recaps.length > 0)).toBe(true);
    expect(states.some((s) => s.respawned.length > 0)).toBe(true);
  });

  it('a different seed gives different hit amounts', () => {
    const amounts = (seed: number): number[] => runCombatScript(seed).flatMap((s) => s.hits.map((h) => h.amount));
    expect(amounts(54321)).not.toEqual(amounts(12345));
  });
});
