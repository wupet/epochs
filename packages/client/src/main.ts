import { TICK_MS } from '@epochs/shared';
import { ClientWorld } from './client-world';
import { connect } from './connection';
import type { Connection } from './connection';
import { describeClient } from './describe';
import { startRenderer } from './render';
import { TickTiming } from './tick-timing';

declare global {
  interface Window {
    /** Tick arrival statistics so far, for checking the feel by hand. */
    epochsTiming?: () => ReturnType<TickTiming['summary']>;
  }
}

document.title = 'Epochs';
console.log(describeClient());

const TIMING_LOG_MS = 10_000;

async function main(): Promise<void> {
  const world = new ClientWorld();
  const timing = new TickTiming();
  window.epochsTiming = () => timing.summary();

  let connection: Connection | null = null;
  const renderer = await startRenderer({
    world,
    onMoveIntent: (tile) => connection?.sendMove(tile),
  });

  connection = connect({
    onOpen: () => renderer.setConnected(true),
    onClose: () => renderer.setConnected(false),
    onMessage: (message) => {
      const now = performance.now();
      if (message.type === 'welcome') {
        world.applyWelcome(message, now);
      } else if (world.applyTick(message, now)) {
        renderer.noteTick(now);
        timing.record(now);
      }
    },
  });

  setInterval(() => console.log('[epochs] tick timing', timing.summary(), `(expected ${TICK_MS} ms)`), TIMING_LOG_MS);
}

main().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  let status = document.getElementById('status');
  if (status === null) {
    status = document.createElement('div');
    status.id = 'status';
    document.body.appendChild(status);
  }
  status.textContent = `Could not start the renderer: ${message}`;
});
