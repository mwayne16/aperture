import type { AlertEvent, PriceAlert } from '@aperture/shared/alerts';
import type { MarketDataStatus, Quote } from '@aperture/shared/marketData';
import type { RealtimeClientMessage, RealtimeServerMessage } from '@aperture/shared/realtime';
import { MAX_REALTIME_SUBSCRIPTIONS } from '@aperture/shared/realtime';
import { normalizeSymbol } from '@aperture/shared/symbols';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import { parseClientMessage } from './realtimeMessages.js';

/** Where the hub gets what it sends. Any part may be missing; it then sends nothing for it. */
export interface RealtimeSources {
  status(): MarketDataStatus;
  latest(symbol: string): Quote | null;
  onChange?(listener: (symbol: string) => void): () => void;
  onStatus?(listener: (status: MarketDataStatus) => void): () => void;
  onAlert?(listener: (event: AlertEvent) => void): () => void;
  onAlertUpdated?(listener: (alert: PriceAlert) => void): () => void;
}

export interface RealtimeHubOptions {
  sources: RealtimeSources;
  /** Called when the symbols connections want change, so live prices follow them. */
  onDemandChange: () => void;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  /** How often quote changes are sent, coalesced to one quote per symbol. */
  flushIntervalMs?: number;
  /** How often connections are pinged; one that missed the previous ping is closed. */
  heartbeatMs?: number;
}

/** Connections at once. The app needs one, plus pop-out windows. */
export const MAX_CONNECTIONS = 20;
/** Unsent data per connection before it counts as too slow and is closed, so memory stays bounded. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

interface Client {
  socket: WebSocket;
  subscriptions: Set<string>;
  focus: string | null;
  /** Subscribed symbols whose quote changed since the last batch. */
  dirty: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  alive: boolean;
}

/**
 * The app's realtime connections. Each subscribes to the symbols it shows and receives their quotes in
 * coalesced batches, the market-data status, and alert events. A subscription is answered at once with the
 * symbols' latest quotes, so a reconnecting app recovers without the messages it missed. Connections that
 * stop answering pings, or fall too far behind, are closed; the app reconnects and subscribes again.
 */
export class RealtimeHub {
  private readonly options: RealtimeHubOptions;
  private readonly flushIntervalMs: number;
  private readonly clients = new Set<Client>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private lastStatus = '';

  constructor(options: RealtimeHubOptions) {
    this.options = options;
    this.flushIntervalMs = options.flushIntervalMs ?? 250;
    const { sources } = options;
    const listen = (unsubscribe: (() => void) | undefined) => {
      if (unsubscribe) this.unsubscribers.push(unsubscribe);
    };
    listen(
      sources.onChange?.((symbol) => {
        this.changed(symbol);
      }),
    );
    listen(
      sources.onStatus?.((status) => {
        this.broadcastStatus(status);
      }),
    );
    listen(
      sources.onAlert?.((event) => {
        this.broadcast({ type: 'alert', event });
      }),
    );
    listen(
      sources.onAlertUpdated?.((alert) => {
        this.broadcast({ type: 'alertUpdated', alert });
      }),
    );
    this.heartbeat = setInterval(() => {
      this.ping();
    }, options.heartbeatMs ?? 30_000);
  }

  /** Takes over a newly opened connection, or closes it when there are too many. */
  attach(socket: WebSocket): void {
    if (this.clients.size >= MAX_CONNECTIONS) {
      socket.close(1013, 'Too many connections');
      return;
    }
    const client: Client = {
      socket,
      subscriptions: new Set(),
      focus: null,
      dirty: new Set(),
      flushTimer: null,
      alive: true,
    };
    this.clients.add(client);
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      this.received(client, isBinary ? null : data.toString('utf8'));
    });
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => {
      this.detach(client);
    });
    socket.on('error', () => {
      socket.terminate();
    });
    this.send(client, { type: 'status', status: this.options.sources.status() });
  }

  /** The symbols open on a page in any connection. */
  focusSymbols(): string[] {
    return [...new Set([...this.clients].flatMap((client) => (client.focus === null ? [] : [client.focus])))];
  }

  /** Every symbol any connection subscribes to. */
  subscribedSymbols(): string[] {
    return [...new Set([...this.clients].flatMap((client) => [...client.subscriptions]))];
  }

  /** Closes every connection and stops listening. */
  close(): void {
    clearInterval(this.heartbeat);
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const client of this.clients) {
      if (client.flushTimer !== null) clearTimeout(client.flushTimer);
      client.socket.close(1001, 'Server shutting down');
    }
    this.clients.clear();
  }

  private received(client: Client, raw: string | null): void {
    if (raw === null) {
      this.send(client, { type: 'error', message: 'Messages must be JSON text.' });
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send(client, { type: 'error', message: parsed.error });
      return;
    }
    this.apply(client, parsed.message);
  }

  private apply(client: Client, message: RealtimeClientMessage): void {
    switch (message.type) {
      case 'subscribe': {
        const added = [...new Set(message.symbols.map(normalizeSymbol))].filter(
          (symbol) => !client.subscriptions.has(symbol),
        );
        if (client.subscriptions.size + added.length > MAX_REALTIME_SUBSCRIPTIONS) {
          this.send(client, {
            type: 'error',
            message: `Subscribe to at most ${String(MAX_REALTIME_SUBSCRIPTIONS)} symbols in total.`,
          });
          return;
        }
        for (const symbol of added) client.subscriptions.add(symbol);
        // ** Answer with what is known now; symbols new to the server follow once their first snapshot arrives.
        const quotes = added.flatMap((symbol) => this.options.sources.latest(symbol) ?? []);
        if (quotes.length > 0) this.send(client, { type: 'quotes', quotes });
        if (added.length > 0) this.options.onDemandChange();
        return;
      }
      case 'unsubscribe': {
        let removed = false;
        for (const symbol of message.symbols.map(normalizeSymbol)) {
          removed = client.subscriptions.delete(symbol) || removed;
          client.dirty.delete(symbol);
        }
        if (removed) this.options.onDemandChange();
        return;
      }
      case 'focus': {
        const focus = message.symbol === null ? null : normalizeSymbol(message.symbol);
        if (focus === client.focus) return;
        client.focus = focus;
        this.options.onDemandChange();
        return;
      }
    }
  }

  private changed(symbol: string): void {
    for (const client of this.clients) {
      if (!client.subscriptions.has(symbol)) continue;
      client.dirty.add(symbol);
      client.flushTimer ??= setTimeout(() => {
        this.flush(client);
      }, this.flushIntervalMs);
    }
  }

  /** Sends one quote per changed symbol, then waits for the next change. */
  private flush(client: Client): void {
    client.flushTimer = null;
    const quotes = [...client.dirty].flatMap((symbol) => this.options.sources.latest(symbol) ?? []);
    client.dirty.clear();
    if (quotes.length > 0) this.send(client, { type: 'quotes', quotes });
  }

  private broadcastStatus(status: MarketDataStatus): void {
    // ** Status is published on every poll round; unchanged copies aren't worth sending.
    const { lastPollAt: _ignored, ...rest } = status;
    const key = JSON.stringify(rest);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.broadcast({ type: 'status', status });
  }

  private broadcast(message: RealtimeServerMessage): void {
    for (const client of this.clients) this.send(client, message);
  }

  private send(client: Client, message: RealtimeServerMessage): void {
    const { socket } = client;
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.options.log.warn('Closing a realtime connection that fell too far behind');
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private ping(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }

  private detach(client: Client): void {
    if (!this.clients.delete(client)) return;
    if (client.flushTimer !== null) clearTimeout(client.flushTimer);
    if (client.subscriptions.size > 0 || client.focus !== null) this.options.onDemandChange();
  }
}
