/**
 * Measures how steadily ticks arrive, for the feel report. Pure: arrival times are passed in.
 */

export interface TickTimingSummary {
  /** Number of intervals between arrivals (one fewer than the number of arrivals). */
  readonly count: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly minMs: number;
}

export class TickTiming {
  private lastArrivalMs: number | null = null;
  private readonly intervals: number[] = [];

  record(arrivalMs: number): void {
    if (this.lastArrivalMs !== null) this.intervals.push(arrivalMs - this.lastArrivalMs);
    this.lastArrivalMs = arrivalMs;
  }

  /** Over the intervals between arrivals. With fewer than 2 arrivals: count 0 and zeros. p95 is nearest-rank. */
  summary(): TickTimingSummary {
    const count = this.intervals.length;
    if (count === 0) return { count: 0, meanMs: 0, p95Ms: 0, maxMs: 0, minMs: 0 };
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const sum = sorted.reduce((total, v) => total + v, 0);
    const rank = Math.max(1, Math.ceil(0.95 * count));
    return {
      count,
      meanMs: sum / count,
      p95Ms: sorted[rank - 1]!,
      maxMs: sorted[count - 1]!,
      minMs: sorted[0]!,
    };
  }
}
