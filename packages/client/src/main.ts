import { TICK_MS } from '@epochs/shared';
import { ClientWorld } from './client-world';
import { connect } from './connection';
import type { Connection } from './connection';
import { createDebugPanel } from './debug-panel';
import { describeClient } from './describe';
import { createRecapOverlay } from './recap';
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

  // The HTML parts: the death recap, and the debug panel (debug: it goes when real progression arrives).
  const dismissRecap = (): void => {
    world.dismissRecap();
    recap.show(world.recap);
  };
  const recap = createRecapOverlay(dismissRecap);
  const panel = createDebugPanel((message) => connection?.sendDebug(message));
  const syncInterface = (): void => {
    recap.show(world.recap);
    panel.update(world.catalog, world.sheet);
  };

  const renderer = await startRenderer({
    world,
    onMoveIntent: (tile) => connection?.sendMove(tile),
    onModeIntent: (mode) => connection?.sendMode(mode),
    onAttackIntent: (enemyId) => connection?.sendAttack(enemyId),
    onAttackMoveIntent: (tile) => connection?.sendAttackMove(tile),
    onDismissRecap: dismissRecap,
  });

  connection = connect({
    onOpen: () => renderer.setConnected(true),
    onClose: () => renderer.setConnected(false),
    onMessage: (message) => {
      const now = performance.now();
      if (message.type === 'welcome') {
        world.applyWelcome(message, now);
      } else if (message.type === 'queue') {
        world.applyQueue(message);
      } else if (message.type === 'full') {
        world.applyFull();
      } else if (message.type === 'tick' && world.applyTick(message, now)) {
        renderer.noteTick(now);
        timing.record(now);
      } else if (message.type === 'sheet') {
        world.applySheet(message);
      } else if (message.type === 'recap') {
        world.applyRecap(message);
      }
      syncInterface();
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
