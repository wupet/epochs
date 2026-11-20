import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TICK_MS, step } from '@epochs/shared';
import type { CharacterView, ServerMessage, TickMessage, WelcomeMessage } from '@epochs/shared';
import { ManualClock } from './manual-clock';
import { MAX_PLAYERS, createWorldServer } from './world-server';
import type { WorldServer, WorldServerOptions } from './world-server';

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

  async function start(options: Omit<WorldServerOptions, 'clock'> = {}): Promise<void> {
    clock = new ManualClock();
    const created = createWorldServer({ clock, ...options });
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
      [{ id: 1, x: origin.x + 1, y: origin.y, speed: 500, via: [] }],
      [],
      [{ id: 1, x: origin.x + 2, y: origin.y, speed: 500, via: [] }],
      [],
      [{ id: 1, x: origin.x + 3, y: origin.y, speed: 500, via: [] }],
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
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x, y: y - 1, speed: 500, via: [] }]);

    move(a, x, y + 6);
    await a.flush();
    // The re-route lands on a rest tick: no step now, and the next step already heads the new way.
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([]);
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x, y, speed: 500, via: [] }]);
  });

  it('applies only the latest of many moves sent within one tick', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    for (let i = 0; i < 999; i++) move(a, x - 5, y - 5);
    move(a, x + 3, y);
    await a.flush();

    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 1, y, speed: 500, via: [] }]);
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([]); // a rest tick: walking is a tile every 2 ticks
    clock.advance(TICK_MS);
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 2, y, speed: 500, via: [] }]);
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
    expect((await a.nextMessage('tick')).moved).toEqual([{ id: 1, x: x + 1, y, speed: 500, via: [] }]);
  });

  it('never sends a path, progress or stepped, and only { id, x, y, speed } (plus via on moved) for a character', async () => {
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
    const characterKeys = ['id', 'speed', 'x', 'y'];
    const movedKeys = ['id', 'speed', 'via', 'x', 'y'];
    // B's welcome plus twelve ticks (six tiles of walking).
    expect(b.client.messages).toHaveLength(13);
    for (const message of b.client.messages) {
      expect(Object.keys(message).sort()).toEqual(message.type === 'welcome' ? welcomeKeys : tickKeys);
      const tick = message as TickMessage;
      const plain = message.type === 'welcome' ? message.characters : tick.joined;
      for (const character of plain) expect(Object.keys(character).sort()).toEqual(characterKeys);
      if (message.type === 'tick') {
        for (const character of tick.moved) {
          expect(Object.keys(character).sort()).toEqual(movedKeys);
          for (const tile of character.via) expect(Object.keys(tile).sort()).toEqual(['x', 'y']);
        }
      }
    }
    for (const text of b.client.raw) {
      expect(text).not.toContain('"path"');
      expect(text).not.toContain('"progress"');
      expect(text).not.toContain('"stepped"');
    }
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

  it('lets 100 play by default', () => {
    expect(MAX_PLAYERS).toBe(100);
  });

  it('queues connections beyond maxPlayers with their 1-based position, and welcomes them nothing', async () => {
    await start({ maxPlayers: 2 });
    await connectAndWelcome();
    await connectAndWelcome();

    const c = await connect();
    const d = await connect();

    expect(await c.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });
    expect(await d.nextMessage('queue')).toEqual({ type: 'queue', position: 2 });
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    await c.flush();
    await d.flush();
    expect(c.messages.map((m) => m.type)).toEqual(['queue']);
    expect(d.messages.map((m) => m.type)).toEqual(['queue']);
  });

  it('admits the first in the queue when a player closes, and moves everyone behind up', async () => {
    await start({ maxPlayers: 2 });
    const a = await connectAndWelcome();
    const b = await connectAndWelcome();
    const c = await connect();
    const d = await connect();
    await c.nextMessage('queue');
    await d.nextMessage('queue');

    a.client.ws.close();
    expect(await d.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });
    clock.advance(TICK_MS);
    const welcomeForC = await c.nextMessage('welcome');
    const tickForB = await b.client.nextMessage('tick');

    expect(welcomeForC.you).toBe(3);
    expect(welcomeForC.characters.map((x) => x.id)).toEqual([2, 3]);
    expect(tickForB.joined.map((x) => x.id)).toEqual([3]);
    expect(tickForB.left).toEqual([1]);
    expect(c.messages.map((m) => m.type)).toEqual(['queue', 'welcome']);
    // D is still waiting: it was told its new place and nothing else.
    await d.flush();
    expect(d.messages.map((m) => m.type)).toEqual(['queue', 'queue']);
  });

  it('never gives a character to a queued client that closes, and moves those behind it up', async () => {
    await start({ maxPlayers: 2 });
    const a = await connectAndWelcome();
    const b = await connectAndWelcome();
    const c = await connect();
    const d = await connect();
    await c.nextMessage('queue');
    await d.nextMessage('queue');

    c.ws.close();
    expect(await d.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });
    await c.closed();
    clock.advance(TICK_MS);
    expect((await b.client.nextMessage('tick')).joined).toEqual([]);

    a.client.ws.close();
    // The server learns of the close a moment later, so tick until D is admitted and welcomed.
    for (let i = 0; i < 50 && !d.messages.some((m) => m.type === 'welcome'); i++) {
      clock.advance(TICK_MS);
      await d.flush();
    }
    const welcomeForD = await d.nextMessage('welcome');
    expect(welcomeForD.you).toBe(3); // C never took an id
    expect(welcomeForD.characters.map((x) => x.id)).toEqual([2, 3]);

    // B has seen every tick so far; D is the only character that joined it.
    await b.client.flush();
    const joined = [a.client, b.client, d].flatMap((client) =>
      client.messages.flatMap((m) => (m.type === 'tick' ? m.joined.map((x) => x.id) : [])),
    );
    expect(joined.filter((id) => id !== 2 && id !== 3)).toEqual([]); // only B (2) and D (3) ever join
    expect(b.client.messages.flatMap((m) => (m.type === 'tick' ? m.joined.map((x) => x.id) : []))).toEqual([3]);
    expect(c.messages.map((m) => m.type)).toEqual(['queue']);
  });

  it('never announces a queued client that is admitted and then closes before the next tick, and frees its slot', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ maxPlayers: 1 });
    const a = await connectAndWelcome();
    const b = await connect();
    expect(await b.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });

    a.client.ws.close();
    await a.client.closed();
    // C joins the queue at position 1 only once B holds the slot, so this proves A's close was handled
    // (B admitted, with no tick yet) before B closes.
    const c = await connect();
    expect(await c.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });

    b.ws.close();
    await b.closed();
    // The server learns of B's close a moment later: tick until C is admitted and welcomed.
    for (let i = 0; i < 50 && !c.messages.some((m) => m.type === 'welcome'); i++) {
      clock.advance(TICK_MS);
      await c.flush();
    }
    const welcomeForC = await c.nextMessage('welcome');
    clock.advance(TICK_MS);
    clock.advance(TICK_MS);
    await c.flush();

    expect(welcomeForC.you).toBe(3); // B took id 2 and never used it
    expect(welcomeForC.characters.map((x) => x.id)).toEqual([3]);
    // Nobody ever sees B (id 2) join, and nobody sees it leave either.
    const ticks = c.messages.filter((m): m is TickMessage => m.type === 'tick');
    expect(ticks.flatMap((m) => m.joined.map((x) => x.id))).toEqual([]);
    expect(ticks.flatMap((m) => m.left)).toEqual([]);
    expect(b.messages.map((m) => m.type)).toEqual(['queue']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('ignores messages from a queued client', async () => {
    await start({ maxPlayers: 1 });
    const a = await connectAndWelcome();
    const b = await connect();
    await b.nextMessage('queue');

    b.send(JSON.stringify({ type: 'move', x: 1, y: 1 }));
    b.send(JSON.stringify({ type: 'mode', mode: 'run' }));
    await b.flush();
    a.client.ws.close();
    await b.flush();
    for (let i = 0; i < 50 && !b.messages.some((m) => m.type === 'welcome'); i++) {
      clock.advance(TICK_MS);
      await b.flush();
    }
    const welcome = await b.nextMessage('welcome');
    clock.advance(TICK_MS);
    expect((await b.nextMessage('tick')).moved).toEqual([]);
    expect(welcome.characters).toEqual([{ id: 2, x: 16, y: 16, speed: 500 }]);
  });

  it('steps every tick after a debug run mode message, then a move', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    a.send(JSON.stringify({ type: 'mode', mode: 'run' }));
    move(a, x + 3, y);
    await a.flush();

    const perTick: CharacterView[][] = [];
    for (let i = 0; i < 3; i++) {
      clock.advance(TICK_MS);
      perTick.push([...(await a.nextMessage('tick')).moved]);
    }
    expect(perTick).toEqual([
      [{ id: 1, x: x + 1, y, speed: 1000, via: [] }],
      [{ id: 1, x: x + 2, y, speed: 1000, via: [] }],
      [{ id: 1, x: x + 3, y, speed: 1000, via: [] }],
    ]);
  });

  it('sends the tiles passed through (as x and y only) for a two-step tick on a debug horse', async () => {
    await start();
    const { client: a, welcome } = await connectAndWelcome();
    const { x, y } = welcome.characters[0]!;

    // Rest one tick in horse mode first, so the horse holds a full tick's worth and sets off at full pace.
    a.send(JSON.stringify({ type: 'mode', mode: 'horse' }));
    await a.flush();
    clock.advance(TICK_MS);
    await a.nextMessage('tick');
    move(a, x, y - 6);
    await a.flush();
    for (let i = 0; i < 3; i++) clock.advance(TICK_MS);
    await waitFor(() => a.messages.filter((m) => m.type === 'tick').length === 4);

    // A rested horse moves two tiles on every tick, from the first.
    const moved = a.messages.flatMap((m) => (m.type === 'tick' ? m.moved : []));
    expect(moved).toEqual([
      { id: 1, x, y: y - 2, speed: 2000, via: [{ x, y: y - 1 }] },
      { id: 1, x, y: y - 4, speed: 2000, via: [{ x, y: y - 3 }] },
      { id: 1, x, y: y - 6, speed: 2000, via: [{ x, y: y - 5 }] },
    ]);
    for (const entry of moved) {
      for (const tile of entry.via) expect(Object.keys(tile).sort()).toEqual(['x', 'y']);
    }
    for (const text of a.raw) {
      expect(text).not.toContain('"path"');
      expect(text).not.toContain('"progress"');
      expect(text).not.toContain('"stepped"');
    }
  });

  it('logs how many ticks it skipped after a stall', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start();

    clock.advance(10_000, 10_000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[epochs] stalled: skipped 36 ticks');
  });

  describe('a tick whose step throws', () => {
    /** A step that throws on its next `failures` calls, then works. */
    function flaky(failures: number): { step: typeof step; setFailures(n: number): void } {
      let remaining = failures;
      return {
        step: (state, intentions) => {
          if (remaining > 0) {
            remaining--;
            throw new Error('boom');
          }
          return step(state, intentions);
        },
        setFailures: (n) => {
          remaining = n;
        },
      };
    }
    const twiceLines = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
      spy.mock.calls.filter((call) => String(call[0]).includes('tick failed twice'));
    function recordClose(client: TestClient): { code: number | undefined; reason: string } {
      const result: { code: number | undefined; reason: string } = { code: undefined, reason: '' };
      client.ws.on('close', (code, reason) => {
        result.code = code;
        result.reason = reason.toString();
      });
      return result;
    }

    it('retries once: the join is welcomed one tick later, and nothing is dropped or logged as dropped', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seam = flaky(1);
      await start({ step: seam.step });
      const client = await connect();

      clock.advance(TICK_MS); // fails
      await client.flush();
      expect(client.messages).toEqual([]);
      clock.advance(TICK_MS); // the retry works
      const welcome = await client.nextMessage('welcome');

      expect(welcome.you).toBe(1);
      expect(welcome.characters.map((c) => c.id)).toEqual([1]);
      expect(client.ws.readyState).toBe(WebSocket.OPEN);
      expect(twiceLines(errors)).toEqual([]);
    });

    it('drops the intentions on a second failure, logs once, closes the dropped join with 1011, and carries on', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const seam = flaky(0);
      await start({ step: seam.step });
      const a = await connectAndWelcome();
      const b = await connect();
      const closeOfB = recordClose(b);
      move(a.client, a.welcome.characters[0]!.x + 2, a.welcome.characters[0]!.y);
      await a.client.flush();
      seam.setFailures(2);

      clock.advance(TICK_MS);
      expect(twiceLines(errors)).toEqual([]);
      clock.advance(TICK_MS);
      await b.closed();

      // One join (B) and one move (A) were held.
      expect(twiceLines(errors)).toEqual([['[epochs] tick failed twice: dropped 2 intentions']]);
      expect(closeOfB.code).toBe(1011);
      expect(closeOfB.reason).toBe('Could not join, please reconnect');
      expect(b.messages).toEqual([]);
      expect(a.client.ws.readyState).toBe(WebSocket.OPEN);

      clock.advance(TICK_MS);
      const tick = await a.client.nextMessage('tick');
      expect(tick.joined).toEqual([]);
      expect(tick.moved).toEqual([]); // A's move was dropped with the rest
      clock.advance(TICK_MS);
      await a.client.nextMessage('tick');
      expect(twiceLines(errors)).toHaveLength(1);
    });

    it('admits the next waiting socket exactly once after closing a dropped join', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const seam = flaky(2);
      await start({ maxPlayers: 1, step: seam.step });
      const a = await connect();
      const closeOfA = recordClose(a);
      const b = await connect();
      expect(await b.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });

      clock.advance(TICK_MS);
      clock.advance(TICK_MS);
      await a.closed();
      expect(closeOfA.code).toBe(1011);
      clock.advance(TICK_MS);
      const welcomeForB = await b.nextMessage('welcome');

      expect(welcomeForB.you).toBe(2);
      expect(welcomeForB.characters.map((c) => c.id)).toEqual([2]);
      // B holds the only slot: a newcomer queues at 1, and A's late close changed nothing.
      const c = await connect();
      expect(await c.nextMessage('queue')).toEqual({ type: 'queue', position: 1 });
      await c.flush();
      for (let i = 0; i < 3; i++) clock.advance(TICK_MS);
      await waitFor(() => b.messages.filter((m) => m.type === 'tick').length === 3);
      expect(b.messages.flatMap((m) => (m.type === 'tick' ? [...m.joined.map((x) => x.id), ...m.left] : []))).toEqual([]);
      expect(c.messages.map((m) => m.type)).toEqual(['queue']);
    });

    it('sends a leave for a character that is in the world but has no connection', async () => {
      let inject = false;
      await start({
        step: (state, intentions) => {
          const next = step(state, intentions);
          if (!inject) return next;
          inject = false;
          return { ...next, characters: [...next.characters, { ...next.characters[0]!, id: 99 }] };
        },
      });
      const a = await connectAndWelcome();

      inject = true;
      clock.advance(TICK_MS);
      expect((await a.client.nextMessage('tick')).joined.map((c) => c.id)).toEqual([99]);
      clock.advance(TICK_MS);
      const tick = await a.client.nextMessage('tick');

      expect(tick.left).toEqual([99]);
      expect(tick.joined).toEqual([]);
      clock.advance(TICK_MS);
      expect((await a.client.nextMessage('tick')).left).toEqual([]);
    });
  });
});
