import { randomInt } from 'node:crypto';
import { TICK_MS, createArenaWorld } from '@epochs/shared';
import { CONTENT_DIR } from '@epochs/tools/paths';
import { SERVER_PORT } from './config';
import { loadContent } from './load-content';
import { MAX_SEED, parseSeed } from './seed';
import { createWorldServer } from './world-server';

// The seed: `EPOCHS_SEED` to replay a world, otherwise a random one. It is always logged.
const seedText = process.env.EPOCHS_SEED;
let seed: number;
if (seedText === undefined || seedText === '') {
  seed = randomInt(MAX_SEED + 1);
} else {
  const parsed = parseSeed(seedText);
  if (parsed === null) {
    console.error(`EPOCHS_SEED must be a whole number from 0 to ${MAX_SEED}, not "${seedText}".`);
    process.exit(1);
  }
  seed = parsed;
}
console.log(`[epochs] seed ${seed}`);

let world;
try {
  world = createArenaWorld(loadContent(CONTENT_DIR), 'arena', seed);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

try {
  const port = await createWorldServer({ world }).listen(SERVER_PORT);
  console.log(`Epochs world server listening on http://localhost:${port} (tick ${TICK_MS} ms)`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `Port ${SERVER_PORT} is in use. Is another \`npm run dev\` (or world server) still running?`,
    );
  } else {
    console.error('The world server could not start:', error);
  }
  process.exit(1);
}
