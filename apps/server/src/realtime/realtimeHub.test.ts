import type { MarketDataStatus } from '@aperture/shared/marketData';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { RealtimeTestClient } from '../test/realtimeClient.js';
import { RealtimeHub, type RealtimeSources } from './realtimeHub.js';

const STATUS: MarketDataStatus = {
  configured: true,
  feedName: 'Fake IEX',
  delayed: false,
  stocks: { state: 'connected', reconnectAttempt: 0, error: null, lastMessageAt: null, streamed: [] },
  crypto: { state: 'idle', reconnectAttempt: 0, error: null, lastMessageAt: null, streamed: [] },
  polled: [],
  lastPollAt: null,
  pollError: null,
};

let server: WebSocketServer | null = null;
let hub: RealtimeHub | null = null;
const clients: RealtimeTestClient[] = [];

/** A hub on a plain ws server, so timing options can be shortened. */
async function startHub(sources: Partial<RealtimeSources> = {}, heartbeatMs = 30_000): Promise<string> {
  const started = new RealtimeHub({
    sources: { status: () => STATUS, latest: () => null, ...sources },
    onDemandChange: () => undefined,
    log: { info: () => undefined, warn: () => undefined },
    heartbeatMs,
  });
  hub = started;
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', (socket) => {
    started.attach(socket);
  });
  await new Promise<void>((resolve) => server?.once('listening', resolve));
  return `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  hub?.close();
  const closing = server;
  if (closing)
    await new Promise((resolve) => {
      closing.close(resolve);
    });
  hub = null;
  server = null;
});

describe('RealtimeHub', () => {
  it('closes a connection that stops answering pings, and keeps one that answers', async () => {
    const url = await startHub({}, 50);
    const silent = await RealtimeTestClient.open(url, { autoPong: false });
    const answering = await RealtimeTestClient.open(url);
    clients.push(silent, answering);
    await vi.waitFor(() => {
      expect(silent.closeCode).not.toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(answering.closeCode).toBeNull();
  });

  it('sends a status only when it changed, ignoring the poll time', async () => {
    let publish: (status: MarketDataStatus) => void = () => undefined;
    const url = await startHub({
      onStatus: (listener) => {
        publish = listener;
        return () => undefined;
      },
    });
    const client = await RealtimeTestClient.open(url);
    clients.push(client);
    await client.next('status');
    publish(STATUS);
    publish({ ...STATUS, lastPollAt: 123 });
    publish({ ...STATUS, polled: ['AAPL'] });
    await client.next('status');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.all('status').map((message) => message.status.polled)).toEqual([[], [], ['AAPL']]);
  });

  it('stops listening to its sources and closes connections when closed', async () => {
    const removed: string[] = [];
    const listen = (name: string) => () => () => {
      removed.push(name);
    };
    const url = await startHub({ onChange: listen('change'), onStatus: listen('status') });
    const client = await RealtimeTestClient.open(url);
    clients.push(client);
    hub?.close();
    await vi.waitFor(() => {
      expect(client.closeCode).toBe(1001);
    });
    expect(removed.sort()).toEqual(['change', 'status']);
  });
});
