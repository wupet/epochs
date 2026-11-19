import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  TICK_MS,
  createWorld,
  gridFromRows,
  parseClientMessage,
  step,
  tickMessage,
  welcomeMessage,
} from '@epochs/shared';
import type { CharacterId, Intention, Tile, WorldState } from '@epochs/shared';
import { startTickLoop } from './tick-loop';
import type { TickClock, TickLoop } from './tick-loop';
import { TEST_MAP_ROWS, TEST_MAP_SPAWN } from './test-map';

export interface WorldServerOptions {
  /** Where ticks come from. Real time by default; tests pass a `ManualClock`. */
  readonly clock?: TickClock;
  readonly rows?: readonly string[];
  readonly spawn?: Tile;
}

export interface WorldServer {
  /** Starts listening and ticking. Resolves with the port actually bound (pass 0 for any free port). */
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/** The longest WebSocket frame the server accepts, in bytes. Real messages are a few dozen. */
const MAX_PAYLOAD_BYTES = 4096;

interface Connection {
  readonly characterId: CharacterId;
  readonly socket: WebSocket;
  /** False until the welcome has been sent. Such a socket is sent nothing else. */
  welcomed: boolean;
}

/**
 * The world server. It owns the one `WorldState`. Clients send intentions over a WebSocket; every
 * tick the server runs `step` on the queued intentions and sends each client what changed. A
 * character reaches a client only as `{ id, x, y }`, via the shared protocol builders.
 */
export function createWorldServer(options: WorldServerOptions = {}): WorldServer {
  const grid = gridFromRows(options.rows ?? TEST_MAP_ROWS);
  let state: WorldState = createWorld(grid, options.spawn ?? TEST_MAP_SPAWN);
  // Joins and leaves are queued in arrival order. Moves are not: only each character's latest move this
  // tick is kept, so a flood of moves cannot grow the queue.
  let queuedLifecycle: Intention[] = [];
  let latestMoves = new Map<CharacterId, Tile>();
  let nextId: CharacterId = 1;
  const connections = new Map<CharacterId, Connection>();
  let loop: TickLoop | undefined;

  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tickMs: TICK_MS }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/world', maxPayload: MAX_PAYLOAD_BYTES });

  // ws re-emits the HTTP server's errors on itself. Without a listener, a bind error (such as the port
  // being in use) would throw out of that emit instead of reaching the rejection in `listen`.
  wss.on('error', () => {});

  wss.on('connection', (socket) => {
    const characterId = nextId++;
    const connection: Connection = { characterId, socket, welcomed: false };
    connections.set(characterId, connection);
    queuedLifecycle.push({ kind: 'join', characterId, subtick: 0 });

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = parseClientMessage(data.toString(), grid);
      if (message === null || message.type !== 'move') return; // mode messages: Task 4
      latestMoves.set(characterId, { x: message.x, y: message.y });
    });
    // A socket error is always followed by a close, which is where we clean up.
    socket.on('error', () => {});
    socket.on('close', () => {
      connections.delete(characterId);
      queuedLifecycle.push({ kind: 'leave', characterId, subtick: 0 });
    });
  });

  const send = (socket: WebSocket, payload: string): void => {
    if (socket.readyState !== WebSocket.OPEN) return;
    // One failing socket must not stop the others getting this tick.
    try {
      socket.send(payload);
    } catch (error) {
      console.error('Send failed:', error);
    }
  };

  /** Queued joins and leaves in arrival order, then one move per character in ascending id order. */
  const takeIntentions = (): Intention[] => {
    const moves: Intention[] = [...latestMoves.entries()]
      .sort(([a], [b]) => a - b)
      .map(([characterId, target]) => ({ kind: 'move', characterId, target, subtick: 0 }));
    return [...queuedLifecycle, ...moves];
  };

  const onTick = (): void => {
    // The loop ends silently if this throws, so one bad tick must not escape.
    try {
      const prev = state;
      const intentions = takeIntentions();
      // Only forget the intentions once `step` has accepted them, so a failed tick is retried next tick.
      const next = step(prev, intentions);
      queuedLifecycle = [];
      latestMoves = new Map();
      state = next;

      const tick = JSON.stringify(tickMessage(prev, state));
      for (const connection of connections.values()) {
        if (connection.welcomed) send(connection.socket, tick);
      }
      // A new socket gets its welcome after this tick's diff, never a tick before it.
      for (const connection of connections.values()) {
        if (connection.welcomed) continue;
        if (!state.characters.some((c) => c.id === connection.characterId)) continue;
        send(connection.socket, JSON.stringify(welcomeMessage(state, connection.characterId)));
        connection.welcomed = true;
      }
    } catch (error) {
      console.error('Tick failed:', error);
    }
  };

  return {
    listen(port) {
      return new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          httpServer.off('error', reject);
          const address = httpServer.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('The server did not bind to a TCP port.'));
            return;
          }
          loop = startTickLoop(onTick, options.clock);
          resolve(address.port);
        });
      });
    },

    async close() {
      loop?.stop();
      loop = undefined;
      for (const { socket } of connections.values()) socket.terminate();
      connections.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
