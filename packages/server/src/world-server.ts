import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  TICK_MS,
  createWorld,
  gridFromRows,
  parseClientMessage,
  queueMessage,
  step,
  tickMessage,
  welcomeMessage,
} from '@epochs/shared';
import type { CharacterId, DebugMovementMode, Intention, Tile, WorldState } from '@epochs/shared';
import { startTickLoop } from './tick-loop';
import type { TickClock, TickLoop } from './tick-loop';
import { TEST_MAP_ROWS, TEST_MAP_SPAWN } from './test-map';

export interface WorldServerOptions {
  /** Where ticks come from. Real time by default; tests pass a `ManualClock`. */
  readonly clock?: TickClock;
  readonly rows?: readonly string[];
  readonly spawn?: Tile;
  /** How many may play at once; later connections wait in a queue. Default `MAX_PLAYERS`. */
  readonly maxPlayers?: number;
  /** The tick function. The shared `step` by default; tests pass one that throws or adds characters. */
  readonly step?: typeof step;
}

/** How many players may be in the world at once. */
export const MAX_PLAYERS = 100;

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
 * character reaches a client only as `{ id, x, y, speed }` (plus `via` when it moved), via the shared
 * protocol builders. At most `maxPlayers` play at once; later connections wait in a first-come queue
 * and are told their position whenever it changes. A waiting connection has no character and no id.
 */
export function createWorldServer(options: WorldServerOptions = {}): WorldServer {
  const grid = gridFromRows(options.rows ?? TEST_MAP_ROWS);
  let state: WorldState = createWorld(grid, options.spawn ?? TEST_MAP_SPAWN);
  // Joins and leaves are queued in arrival order. Moves are not: only each character's latest move this
  // tick is kept, so a flood of moves cannot grow the queue.
  let queuedLifecycle: Intention[] = [];
  let latestMoves = new Map<CharacterId, Tile>();
  // Debug: the latest movement mode per character this tick, kept like the latest moves.
  let latestModes = new Map<CharacterId, DebugMovementMode>();
  let nextId: CharacterId = 1;
  const maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  const stepWorld = options.step ?? step;
  /** How many ticks in a row `step` has thrown. A tick that fails twice has its intentions dropped. */
  let failedTicks = 0;
  /** The playing connections: those with a character (a join has been queued). */
  const connections = new Map<CharacterId, Connection>();
  /** Sockets waiting for a place, first come first served. The first is at position 1. */
  const waiting: WebSocket[] = [];
  const idOf = new WeakMap<WebSocket, CharacterId>();
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

  /** Gives the socket a character: an id and a queued join, to be welcomed after the tick that adds it. */
  const admit = (socket: WebSocket): void => {
    const characterId = nextId++;
    idOf.set(socket, characterId);
    connections.set(characterId, { characterId, socket, welcomed: false });
    queuedLifecycle.push({ kind: 'join', characterId, subtick: 0 });
  };

  /** Tells each waiting socket from `fromIndex` on its (new) 1-based position. */
  const sendQueuePositions = (fromIndex: number): void => {
    for (let i = fromIndex; i < waiting.length; i++) send(waiting[i]!, JSON.stringify(queueMessage(i + 1)));
  };

  wss.on('connection', (socket) => {
    if (connections.size < maxPlayers) {
      admit(socket);
    } else {
      waiting.push(socket);
      sendQueuePositions(waiting.length - 1);
    }

    socket.on('message', (data, isBinary) => {
      const characterId = idOf.get(socket);
      if (characterId === undefined || isBinary) return; // a waiting socket is ignored
      const message = parseClientMessage(data.toString(), grid);
      if (message === null) return;
      if (message.type === 'move') latestMoves.set(characterId, { x: message.x, y: message.y });
      else latestModes.set(characterId, message.mode);
    });
    // A socket error is always followed by a close, which is where we clean up.
    socket.on('error', () => {});
    socket.on('close', () => {
      const characterId = idOf.get(socket);
      if (characterId === undefined) {
        // It never played. Drop it from the queue; those behind it move up.
        const index = waiting.indexOf(socket);
        if (index === -1) return;
        waiting.splice(index, 1);
        sendQueuePositions(index);
        return;
      }
      connections.delete(characterId);
      queuedLifecycle.push({ kind: 'leave', characterId, subtick: 0 });
      // The slot is free: the first in line plays, and everyone behind moves up.
      const next = waiting.shift();
      if (next !== undefined) {
        admit(next);
        sendQueuePositions(0);
      }
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

  /**
   * Queued joins and leaves in arrival order, then one debug mode per character in ascending id order,
   * then one move per character in ascending id order.
   */
  const takeIntentions = (): Intention[] => {
    const modes: Intention[] = [...latestModes.entries()]
      .sort(([a], [b]) => a - b)
      .map(([characterId, mode]) => ({ kind: 'mode', characterId, mode, subtick: 0 }));
    const moves: Intention[] = [...latestMoves.entries()]
      .sort(([a], [b]) => a - b)
      .map(([characterId, target]) => ({ kind: 'move', characterId, target, subtick: 0 }));
    return [...queuedLifecycle, ...modes, ...moves];
  };

  /**
   * Gives up on the held intentions after a tick failed twice. A dropped join's socket is told to
   * reconnect and forgotten (so its close does nothing), and the next waiting socket takes its place.
   */
  const dropIntentions = (dropped: readonly Intention[]): void => {
    queuedLifecycle = [];
    latestMoves = new Map();
    latestModes = new Map();
    console.error(`[epochs] tick failed twice: dropped ${dropped.length} intentions`);
    for (const intention of dropped) {
      if (intention.kind !== 'join') continue;
      const connection = connections.get(intention.characterId);
      if (connection === undefined) continue; // its socket already closed
      connections.delete(intention.characterId);
      idOf.delete(connection.socket);
      connection.socket.close(1011, 'Could not join, please reconnect');
      const next = waiting.shift();
      if (next !== undefined) {
        admit(next);
        sendQueuePositions(0);
      }
    }
  };

  /** Queues a leave for every character in the world that no playing connection holds. */
  const queueGhostLeaves = (): void => {
    for (const character of state.characters) {
      if (connections.has(character.id)) continue;
      const leaving = queuedLifecycle.some((i) => i.kind === 'leave' && i.characterId === character.id);
      if (!leaving) queuedLifecycle.push({ kind: 'leave', characterId: character.id, subtick: 0 });
    }
  };

  const onTick = (): void => {
    // The loop ends silently if this throws, so one bad tick must not escape.
    try {
      queueGhostLeaves();
      const prev = state;
      const intentions = takeIntentions();
      // Only forget the intentions once `step` has accepted them, so a failed tick is retried next tick.
      let next: WorldState;
      try {
        next = stepWorld(prev, intentions);
      } catch (error) {
        console.error('Tick failed:', error);
        failedTicks++;
        if (failedTicks >= 2) {
          failedTicks = 0;
          dropIntentions(intentions);
        }
        return;
      }
      failedTicks = 0;
      queuedLifecycle = [];
      latestMoves = new Map();
      latestModes = new Map();
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
          loop = startTickLoop(onTick, options.clock, undefined, (skipped) =>
            console.warn(`[epochs] stalled: skipped ${skipped} ticks`),
          );
          resolve(address.port);
        });
      });
    },

    async close() {
      loop?.stop();
      loop = undefined;
      for (const { socket } of connections.values()) socket.terminate();
      connections.clear();
      const waitingSockets = waiting.splice(0);
      for (const socket of waitingSockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
