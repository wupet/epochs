import { TICK_MS } from '@epochs/shared';
import { SERVER_PORT } from './config';
import { createWorldServer } from './world-server';

try {
  const port = await createWorldServer().listen(SERVER_PORT);
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
