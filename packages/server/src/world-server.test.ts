import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TICK_MS } from '@epochs/shared';
import type { CharacterView, ServerMessage, TickMessage, WelcomeMessage } from '@epochs/shared';
import { ManualClock } from './manual-clock';
import { createWorldServer } from './world-server';
import type { WorldServer } from './world-server';

/** Polls until `predicate` is true. Fails after `timeoutMs`. Never sleeps blindly. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms`);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

interface TestClient {
  readonly ws: WebSocket;
  /** Every raw text frame received, in order. */
  readonly raw: string[];
  /** Every parsed message received, in order. */
  readonly messages: ServerMessage[];
  /** Waits for the next not-yet-taken message of this type, and takes it. */
  nextMessage<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>>;
  /**
   * Waits until the server has handled everything sent so far. The server answers a ping
   * after the frames that came before it, so a pong means they have been processed.
   */
  flush(): Promise<void>;
  send(data: string | Buffer): void;
  closed(): Promise<void>;
}

describe('world server', () => {
  let server: WorldServer | undefined;
  let clock: ManualClock;
  let port: number;
  const clients: TestClient[] = [];

  async function start(): Promise<void> {
    clock = new ManualClock();
    const created = createWorldServer({ clock });
    server = created;
    port = await created.listen(0);
  }

  async function connect(): Promise<TestClient> {
    const ws = new WebSocket(`ws://localhost:${port}/world`);
    const raw: string[] = [];
    const messages: ServerMessage[] = [];
    const untaken: ServerMessage[] = [];
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      raw.push(text);
      const message = JSON.parse(text) as ServerMessage;
      messages.push(message);
      untaken.push(message);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const client: TestClient = {
      ws,
      raw,
      messages,
      async nextMessage(type) {
        await waitFor(() => untaken.some((m) => m.type === type));
        const index = untaken.findIndex((m) => m.type === type);
        return untaken.splice(index, 1)[0] as never;
      },
      async flush() {
        const ponged = new Promise<void>((resolve) => ws.once('pong', () => resolve()));
        ws.ping();
        await ponged;
      },
      send: (data) => ws.send(data),
      closed: () =>
        ws.readyState === WebSocket.CLOSED
          ? Promise.resolve()
          : new Promise<void>((resolve) => ws.once('close', () => resolve())),
    };
    clients.push(client);
    return client;
  }

  /** Connects and ticks once, so the client has its welcome. */
  async function connectAndWelcome(): Promise<{ client: TestClient; welcome: WelcomeMessage }> {
    const client = await connect();
    clock.advance(TICK_MS);
    const welcome = await client.nextMessage('welcome');
    return { client, welcome };
  }

  const move = (client: TestClient, x: number, y: number): void =>
    client.send(JSON.stringify({ type: 'move', x, y }));

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const { ws } of clients) ws.terminate();
    clients.length = 0;
    await server?.close();
    server = undefined;
  });

  it('answers a health check with the shared tick length', async () => {
    await start();

    const response = await fetch(`http://localhost:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true,"tickMs":250}');
  });

  it('rejects listen when the port is already in use, instead of crashing', async () => {
    await start();
    const second = createWorldServer({ clock: new ManualClock() });

    try {
      await expect(second.listen(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await second.close();
    }
  });

  it('answers anything else over HTTP with 404', async () => {
    await start();

    const response = await fetch(`http://localhost:${port}/nope`);

    expect(response.status).toBe(404);
  });

  it('welcomes a client on the next tick with the grid and itself', async () => {
    await start();

    const { welcome } = await connectAndWelcome();

    expect(welcome.you).toBe(1);
    expect(welcome.grid.width).toBe(32);
    expect(welcome.grid.height).toBe(32);
    expect(welcome.grid.rows).toHaveLength(32);
    expect(welcome.characters.map((c) => c.id)).toEqual([1]);
  });

  it('sends nothing to a client before its welcome', async () => {
    await start();
    const client = await connect();

    // The client is connected but no tick has run: nothing is sent.
    await client.flush();
    expect(client.messages).toEqual([]);

    clock.advance(TICK_MS);
    await client.nextMessage('welcome');
    expect(client.messages.map((m) => m.type)).toEqual(['welcome']);
  });

  it('lets two clients see each other', async () => {
    await start();
    const a = await connectAndWelcome();
    const b = await connect();
    clock.advance(TICK_MS);

    const tickForA = await a.client.nextMessage('tick');
    const welcomeForB = await b.nextMessage('welcome');

    expect(welcomeForB.you).toBe(2);
    expect(tickForA.joined.map((c) => c.id)).toEqual([welcomeForB.you]);
    expect(welcomeForB.characters.map((c) => c.id)).toEqual([1, 2]);
  });

  it('walks a character one tile every 2 ticks (the first on the next tick) to its target', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const origin = welcome.characters[0]!;

    move(a, origin.x + 3, origin.y);
    await a.flush();

    // Walking is a tile every 2 ticks: it moves on ticks 1, 3 and 5 and stands still on 2, 4 and 6.
    const perTick: CharacterView[][] = [];
    for (let i = 0; i < 6; i++) {
      clock.advance(TICK_MS);
      perTick.push([...(await a.nextMessage('tick')).moved]);
    }

    expect(perTick).toEqual([
      [{ id: 1, x: origin.x + 1, y: origin.y }],
      [],
      [{ id: 1, x: origin.x + 2, y: origin.y }],
      [],
      [{ id: 1, x: origin.x + 3, y: origin.y }],
      [],
    ]);
  });

  it('re-routes when a new move arrives mid-walk', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    move(a, x, y - 6);
    await a.flush();
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x, y: y - 1 }]);

    move(a, x, y + 6);
    await a.flush();
    // The re-route lands on a rest tick: no step now, and the next step already heads the new way.
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([]);
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x, y }]);
  });

  it('applies only the latest of many moves sent within one tick', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    for (let i = 0; i < 999; i++) move(a, x - 5, y - 5);
    move(a, x + 3, y);
    await a.flush();

    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 1, y }]);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([]); // a rest tick: walking is a tile every 2 ticks
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 2, y }]);
  });

  it('ignores bad messages, keeps the socket open, and still accepts a valid move', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    a.send('garbage');
    a.send('{"type":"move","x":99,"y":0}');
    a.send('{"type":"teleport"}');
    a.send(Buffer.from([1, 2, 3]));
    await a.flush();

    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([]);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);

    move(a, x + 2, y);
    await a.flush();
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 1, y }]);
  });

  it('never sends a path, and only { id, x, y } for a character', async () => {
    await start();
    const a = await connectAndWelcome();
    const b = await connectAndWelcome();
    const { x, y } = a.welcome.characters[0]!;

    move(a.client, x, y + 10);
    await a.client.flush();
    for (let i = 0; i < 12; i++) {
      clock.advance(TICK_MS);
      await b.client.nextMessage('tick');
    }

    const welcomeKeys = ['characters', 'grid', 'tick', 'type', 'you'];
    const tickKeys = ['joined', 'left', 'moved', 'tick', 'type'];
    const characterKeys = ['id', 'x', 'y'];
    // B's welcome plus twelve ticks (six tiles of walking).
    expect(b.client.messages).toHaveLength(13);
    for (const message of b.client.messages) {
      expect(Object.keys(message).sort()).toEqual(message.type === 'welcome' ? welcomeKeys : tickKeys);
      const characters =
        message.type === 'welcome'
          ? message.characters
          : [...(message as TickMessage).moved, ...(message as TickMessage).joined];
      for (const character of characters) expect(Object.keys(character).sort()).toEqual(characterKeys);
    }
    for (const text of b.client.raw) expect(text).not.toContain('"path"');
    expect(b.client.messages.some((m) => m.type === 'tick' && m.moved.length > 0)).toBe(true);
  });

  it('tells the others when a client closes mid-walk', async () => {
    await start();
    const a = await connectAndWelcome();
    const b = await connectAndWelcome();
    const { x, y } = a.welcome.characters[0]!;

    move(a.client, x, y + 10);
    await a.client.flush();
    clock.advance(TICK_MS);
    await b.client.nextMessage('tick');

    a.client.ws.close();
    // The server learns of the close a moment later, so tick until the leave shows up.
    let left: readonly number[] = [];
    for (let i = 0; i < 50 && left.length === 0; i++) {
      clock.advance(TICK_MS);
      left = (await b.client.nextMessage('tick')).left;
    }

    expect(left).toEqual([a.welcome.you]);
  });

  it('never announces a client that closed before any tick', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await start();
    const b = await connectAndWelcome();

    const c = await connect();
    c.ws.terminate();
    await c.closed();
    // Round trips on B give the server time to see C's socket close before the next tick.
    await b.client.flush();
    await b.client.flush();
    clock.advance(TICK_MS);
    const first = await b.client.nextMessage('tick');
    clock.advance(TICK_MS);
    const second = await b.client.nextMessage('tick');

    expect(first.joined).toEqual([]);
    expect(second.joined).toEqual([]);
    expect(b.client.messages.flatMap((m) => (m.type === 'tick' ? m.left : []))).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});
