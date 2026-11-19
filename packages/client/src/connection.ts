/**
 * The WebSocket to the world server. Parses what arrives and sends intentions. No reconnecting: a
 * page reload connects again.
 */
import type { DebugMovementMode, ModeMessage, MoveMessage, ServerMessage, Tile } from '@epochs/shared';
import { parseServerMessage } from './client-world';

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
}

export function connect(handlers: ConnectionHandlers): Connection {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${scheme}://${location.host}/world`);
  let open = false;

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
      if (!open) return;
      const message: MoveMessage = { type: 'move', x: tile.x, y: tile.y };
      socket.send(JSON.stringify(message));
    },
    sendMode(mode: DebugMovementMode): void {
      if (!open) return;
      const message: ModeMessage = { type: 'mode', mode };
      socket.send(JSON.stringify(message));
    },
  };
}
