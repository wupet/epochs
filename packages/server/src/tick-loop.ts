import { TICK_MS } from '@epochs/shared';

/** A source of time and wake-ups. Real in production, manual in tests. */
export interface TickClock {
  /** Monotonic milliseconds. Only differences between readings mean anything. */
  now(): number;
  /** Runs `run` after `delayMs`. Returns a function that cancels it. */
  schedule(delayMs: number, run: () => void): () => void;
}

export const systemClock: TickClock = {
  now: () => performance.now(),
  schedule(delayMs, run) {
    const handle = setTimeout(run, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface TickLoop {
  stop(): void;
  ticksRun(): number;
}

/**
 * Runs `onTick` once every `tickMs`, without drift. The number of ticks that
 * are due is worked out from the start time on every wake-up, so a late
 * wake-up is caught up (in a burst if need be) and never shifts later ticks.
 * Nothing runs at start; the first tick is due one tick after it.
 */
export function startTickLoop(
  onTick: () => void,
  clock: TickClock = systemClock,
  tickMs: number = TICK_MS,
): TickLoop {
  const start = clock.now();
  let ran = 0;
  let stopped = false;
  let cancelWake: (() => void) | undefined;

  const scheduleNext = (): void => {
    const delay = Math.max(0, start + (ran + 1) * tickMs - clock.now());
    cancelWake = clock.schedule(delay, wake);
  };

  const wake = (): void => {
    cancelWake = undefined;
    if (stopped) return;
    const due = Math.floor((clock.now() - start) / tickMs);
    while (ran < due && !stopped) {
      ran++;
      onTick();
    }
    if (!stopped) scheduleNext();
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      cancelWake?.();
      cancelWake = undefined;
    },
    ticksRun: () => ran,
  };
}
