import { TICK_MS } from '@epochs/shared';
import { SERVER_PORT } from './config';
import { createWorldServer } from './server';

const server = createWorldServer();
server.listen(SERVER_PORT, () => {
  console.log(`Epochs world server listening on http://localhost:${SERVER_PORT} (tick ${TICK_MS} ms)`);
});
