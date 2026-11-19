import { TICK_MS } from '@epochs/shared';
import { SERVER_PORT } from './config';
import { createWorldServer } from './world-server';

const port = await createWorldServer().listen(SERVER_PORT);
console.log(`Epochs world server listening on http://localhost:${port} (tick ${TICK_MS} ms)`);
