/**
 * The WebSocket to the world server. Parses what arrives and sends intentions. No reconnecting: a
 * page reload connects again.
 */
import type {
  AttackMessage,
  AttackMoveMessage,
  ClientMessage,
  DebugMessage,
  DebugMovementMode,
  EnemyId,
  ModeMessage,
  MoveMessage,
  ServerMessage,
  Tile,
} from '@epochs/shared';
import { parseServerMessage } from './client-world';

/** Debug: every message the debug panel sends (the shared `DebugMessage` union, the nine `debug-…` types). */
export type DebugClientMessage = DebugMessage;

export interface ConnectionHandlers {
  onMessage(message: ServerMessage): void;
  onOpen(): void;
  onClose(): void;
}

export interface Connection {
  readonly isOpen: boolean;
  /** Send an intention to walk to `tile`. Does nothing unless the socket is open. */
  sendMove(tile: Tile): void;
  /** Send a debug movement mode (walk, run or horse). Does nothing unless the socket is open. */
  sendMode(mode: DebugMovementMode): void;
  /** Send an intention to chase an enemy and attack it until it dies. Does nothing unless the socket is open. */
  sendAttack(enemyId: EnemyId): void;
  /** Send an intention to walk to `tile`, attacking enemies that come into reach. Does nothing unless the socket is open. */
  sendAttackMove(tile: Tile): void;
  /** Debug: send one debug message. Does nothing unless the socket is open. */
  sendDebug(message: DebugClientMessage): void;
}

export function connect(handlers: ConnectionHandlers): Connection {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/world`);
  let open = false;
  const send = (message: ClientMessage): void => {
    if (open) socket.send(JSON.stringify(message));
  };

  socket.addEventListener('open', () => {
    open = true;
    handlers.onOpen();
  });
  socket.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const message = parseServerMessage(event.data);
    if (message !== null) handlers.onMessage(message);
  });
  socket.addEventListener('close', () => {
    open = false;
    handlers.onClose();
  });

  return {
    get isOpen() {
      return open;
    },
    sendMove(tile: Tile): void {
      const message: MoveMessage = { type: 'move', x: tile.x, y: tile.y };
      send(message);
    },
    sendMode(mode: DebugMovementMode): void {
      const message: ModeMessage = { type: 'mode', mode };
      send(message);
    },
    sendAttack(enemyId: EnemyId): void {
      const message: AttackMessage = { type: 'attack', enemyId };
      send(message);
    },
    sendAttackMove(tile: Tile): void {
      const message: AttackMoveMessage = { type: 'attack-move', x: tile.x, y: tile.y };
      send(message);
    },
    sendDebug(message: DebugClientMessage): void {
      send(message);
    },
  };
}
