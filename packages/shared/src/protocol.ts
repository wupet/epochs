/**
 * The wire protocol: what the server sends to clients and what clients may send back. Pure: no
 * randomness, no clock, no I/O.
 *
 * Hidden information never reaches the client. Characters leave the server only as `{ id, x, y, speed }`,
 * built field by field in `viewOf` (a moved character also carries `via`, the tiles it passed
 * through); a character's `path`, `progress` and `stepped` are never copied into a message.
 */
import { gridToRows, inBounds } from './grid';
import type { Grid } from './grid';
import { isDebugMovementMode } from './movement';
import type { DebugMovementMode } from './movement';
import type { Character, CharacterId, WorldState } from './world';

/** What a client may see of a character. */
export interface CharacterView {
  readonly id: CharacterId;
  readonly x: number;
  readonly y: number;
  /** Millitiles of progress per tick. */
  readonly speed: number;
}

/** A character that moved this tick: `via` lists the tiles it passed through before its final one. */
export interface MovedView extends CharacterView {
  readonly via: readonly { readonly x: number; readonly y: number }[];
}

/** The grid as sent to a client: '#' is blocked, '.' is open, one string per row. */
export interface GridView {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}

/** Sent once, when a client joins: the whole grid and everyone in it. */
export interface WelcomeMessage {
  readonly type: 'welcome';
  readonly you: CharacterId;
  readonly tick: number;
  readonly grid: GridView;
  readonly characters: readonly CharacterView[];
}

/** Sent every tick: what changed since the last one. */
export interface TickMessage {
  readonly type: 'tick';
  readonly tick: number;
  readonly moved: readonly MovedView[];
  readonly joined: readonly CharacterView[];
  readonly left: readonly CharacterId[];
}

/** Sent to a client waiting to join: its place in the queue. */
export interface QueueMessage {
  readonly type: 'queue';
  readonly position: number;
}

export type ServerMessage = WelcomeMessage | TickMessage | QueueMessage;

/** A client's intention to walk to a tile. The server decides whether and how it happens. */
export interface MoveMessage {
  readonly type: 'move';
  readonly x: number;
  readonly y: number;
}

/** Debug: running and riding get real rules later. A client's request to change its movement mode. */
export interface ModeMessage {
  readonly type: 'mode';
  readonly mode: DebugMovementMode;
}

export type ClientMessage = MoveMessage | ModeMessage;

/** The longest client message the server will parse, in characters. */
export const MAX_CLIENT_MESSAGE_LENGTH = 256;

/** The only part of a character a client may see. Copies id, x, y and speed and nothing else. */
export function viewOf(character: Character): CharacterView {
  return { id: character.id, x: character.tile.x, y: character.tile.y, speed: character.speed };
}

export function queueMessage(position: number): QueueMessage {
  return { type: 'queue', position };
}

function byId(a: { readonly id: CharacterId }, b: { readonly id: CharacterId }): number {
  return a.id - b.id;
}

export function welcomeMessage(state: WorldState, you: CharacterId): WelcomeMessage {
  return {
    type: 'welcome',
    you,
    tick: state.tick,
    grid: { width: state.grid.width, height: state.grid.height, rows: gridToRows(state.grid) },
    characters: state.characters.map(viewOf).sort(byId),
  };
}

/** What changed between two consecutive ticks. All three lists are sorted by id. */
export function tickMessage(prev: WorldState, next: WorldState): TickMessage {
  const before = new Map<CharacterId, Character>(prev.characters.map((c) => [c.id, c]));
  const after = new Map<CharacterId, Character>(next.characters.map((c) => [c.id, c]));

  const joined: CharacterView[] = [];
  const moved: MovedView[] = [];
  for (const character of next.characters) {
    const old = before.get(character.id);
    if (old === undefined) joined.push(viewOf(character));
    else if (old.tile.x !== character.tile.x || old.tile.y !== character.tile.y) {
      const via = character.stepped.slice(0, -1).map((t) => ({ x: t.x, y: t.y }));
      moved.push({ ...viewOf(character), via });
    }
  }
  const left: CharacterId[] = prev.characters.filter((c) => !after.has(c.id)).map((c) => c.id);

  return {
    type: 'tick',
    tick: next.tick,
    moved: moved.sort(byId),
    joined: joined.sort(byId),
    left: left.sort((a, b) => a - b),
  };
}

/**
 * Check a raw client message. Returns a fresh `MoveMessage` or `ModeMessage`, or null if the message
 * is too long, is not JSON, or is not exactly `{ type: 'move', x, y }` (coordinates whole numbers
 * inside the grid; a blocked tile is still valid, as the server routes to the nearest reachable one)
 * or `{ type: 'mode', mode }` (a debug movement mode).
 */
export function parseClientMessage(raw: string, grid: Grid): ClientMessage | null {
  if (raw.length > MAX_CLIENT_MESSAGE_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  // Debug: running and riding get real rules later.
  if (keys.length === 2 && keys[0] === 'mode' && keys[1] === 'type') {
    const { type, mode } = value as { type: unknown; mode: unknown };
    if (type !== 'mode' || !isDebugMovementMode(mode)) return null;
    return { type: 'mode', mode };
  }
  if (keys.length !== 3 || keys[0] !== 'type' || keys[1] !== 'x' || keys[2] !== 'y') return null;
  const { type, x, y } = value as { type: unknown; x: unknown; y: unknown };
  if (type !== 'move') return null;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (!inBounds(grid, { x, y })) return null;
  return { type: 'move', x, y };
}
