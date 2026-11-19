import { createServer, type Server } from 'node:http';
import { TICK_MS } from '@epochs/shared';

/**
 * The world server's HTTP listener. For now it only answers a health check;
 * milestone 0.2 attaches the WebSocket connection and the tick loop to it.
 */
export function createWorldServer(): Server {
  return createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tickMs: TICK_MS }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
}
