import type { TickClock } from './tick-loop';

interface Pending {
  due: number;
  run: () => void;
}

/**
 * A clock that only moves when a test says so. Starts at 0.
 * Used by the tick loop tests and the server tests.
 */
export class ManualClock implements TickClock {
  private time = 0;
  private pending: Pending[] = [];

  now(): number {
    return this.time;
  }

  schedule(delayMs: number, run: () => void): () => void {
    const entry: Pending = { due: this.time + Math.max(0, delayMs), run };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((p) => p !== entry);
    };
  }

  /** How many scheduled callbacks have neither fired nor been cancelled. */
  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Moves time forward by `ms`. Callbacks that fall due within the window fire
   * in order, each `lateByMs` after its due time but never past the new now.
   * Callbacks scheduled while this runs are eligible within the same advance.
   */
  advance(ms: number, lateByMs = 0): void {
    const end = this.time + ms;
    for (;;) {
      let next: Pending | undefined;
      let nextFireAt = Infinity;
      for (const p of this.pending) {
        if (p.due > end) continue;
        const fireAt = Math.min(p.due + lateByMs, end);
        // `pending` stays in scheduling order, so a strict < keeps ties in that order.
        if (fireAt < nextFireAt) {
          next = p;
          nextFireAt = fireAt;
        }
      }
      if (next === undefined) break;
      this.pending = this.pending.filter((p) => p !== next);
      this.time = Math.max(this.time, nextFireAt);
      next.run();
    }
    this.time = end;
  }
}
