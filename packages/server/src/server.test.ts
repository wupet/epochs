import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { TICK_MS } from '@epochs/shared';
import { createWorldServer } from './server';

describe('world server', () => {
  const server = createWorldServer();

  afterEach(() => {
    server.close();
  });

  it('answers a health check with the shared tick length', async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://localhost:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, tickMs: TICK_MS });
  });
});
