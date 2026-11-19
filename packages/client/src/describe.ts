import { TICK_MS } from '@epochs/shared';

/** A one-line description of the client build, used to prove the shared package is wired in. */
export function describeClient(): string {
  return `Epochs client (tick ${TICK_MS} ms)`;
}
