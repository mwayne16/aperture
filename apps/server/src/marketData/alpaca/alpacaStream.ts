import { streaming, type MarketDataClient } from '@alpacahq/alpaca-trade-api';
import type { MarketStream, StreamChannel, StreamHandlers, StreamStatus } from '../provider.js';
import { normalizeQuote, normalizeTrade } from './alpacaPayloads.js';

/** Reconnect attempts after a drop before a channel stops trying (the server retries it later). */
const MAX_RECONNECT_ATTEMPTS = 10;

export interface AlpacaStreamOptions {
  data: MarketDataClient;
  feed: 'iex' | 'sip' | 'delayed_sip';
  handlers: StreamHandlers;
  /** Replaces each channel's address, for tests. */
  urls?: Partial<Record<StreamChannel, string>>;
  /** Shortens the reconnect backoff, for tests. Defaults: 10 attempts, 1 s doubling to 64 s. */
  reconnect?: { maxAttempts?: number; initialMs?: number; maxMs?: number };
}

interface Failure {
  message: string;
  retryable: boolean;
}

/**
 * What Alpaca's stream error codes mean for the user, by the SDK's text for each code. The keys travel
 * in the auth frame, so stream errors are always replaced with these words and never passed on.
 */
const FAILURES: Record<string, Failure> = {
  'not authenticated': { message: 'Alpaca rejected the API keys.', retryable: false },
  'auth failed': { message: 'Alpaca rejected the API keys.', retryable: false },
  'auth timeout': { message: 'Alpaca timed out waiting for the stream to sign in.', retryable: true },
  'connection limit exceeded': {
    message:
      'Another connection is already using these Alpaca keys; the plan allows one per feed. Stop the other server or app.',
    retryable: true,
  },
  'symbol limit exceeded': {
    message: 'Alpaca refused more symbols than the plan allows on one connection.',
    retryable: true,
  },
  'insufficient subscription': {
    message:
      "The Alpaca plan doesn't include this stream. The free plan covers the IEX feed (ALPACA_DATA_FEED=iex).",
    retryable: false,
  },
  'slow client': {
    message: 'Alpaca closed the stream because the server read it too slowly.',
    retryable: true,
  },
};

/** Errors about a single message, which leave the connection itself working. */
const MESSAGE_ERROR = /^failed to (decode|process) message/;

type Client = streaming.StockDataStream | streaming.CryptoDataStream;

interface Connection {
  client: Client;
  symbols: string[];
  attempt: number;
  failure: Failure | null;
  closing: boolean;
}

/**
 * Alpaca's stocks and crypto streams behind one MarketStream. Each channel connects the first time it has
 * symbols and then stays open. The SDK reconnects with backoff and resubscribes; this adapter checks each
 * tick, reports each channel's state in plain words, and only reports a channel disconnected once the SDK
 * has stopped retrying.
 */
export function openAlpacaStream(options: AlpacaStreamOptions): MarketStream {
  const connections: Partial<Record<StreamChannel, Connection>> = {};
  const { handlers } = options;

  /** `notice` is a refusal reported while the channel stays connected, e.g. a symbol limit. */
  function report(
    channel: StreamChannel,
    state: StreamStatus['state'],
    connection: Connection,
    notice: string | null = null,
  ): void {
    const failure = connection.closing ? null : connection.failure;
    let error = state === 'connected' ? notice : (failure?.message ?? null);
    if (state === 'disconnected' && !connection.closing && error === null)
      error = 'The connection to Alpaca closed.';
    if (
      state === 'disconnected' &&
      !connection.closing &&
      connection.attempt > 0 &&
      failure?.retryable !== false
    ) {
      error = `${error ?? 'The connection to Alpaca closed.'} Stopped retrying after ${String(connection.attempt)} attempts.`;
    }
    handlers.onStatus({
      channel,
      state,
      reconnectAttempt: state === 'reconnecting' ? connection.attempt : 0,
      error,
      retryable: failure?.retryable ?? true,
    });
  }

  function open(channel: StreamChannel): Connection {
    const settings = {
      url: options.urls?.[channel],
      maxReconnectAttempts: options.reconnect?.maxAttempts ?? MAX_RECONNECT_ATTEMPTS,
      initialReconnectMs: options.reconnect?.initialMs,
      maxReconnectMs: options.reconnect?.maxMs,
    };
    const client: Client =
      channel === 'stocks'
        ? options.data.stockStream({ ...settings, feed: options.feed })
        : options.data.cryptoStream(settings);
    const connection: Connection = { client, symbols: [], attempt: 0, failure: null, closing: false };

    client.onTrade((raw) => {
      const trade = normalizeTrade(raw);
      if (trade) handlers.onTrade(trade);
    });
    client.onQuote((raw) => {
      const quote = normalizeQuote(raw);
      if (quote) handlers.onQuote(quote);
    });
    client.on(streaming.EVENT.SUBSCRIPTION, (subscriptions: Record<string, string[] | undefined>) => {
      const quotes = new Set(subscriptions.quotes ?? []);
      handlers.onSubscribed(
        channel,
        (subscriptions.trades ?? []).filter((symbol) => quotes.has(symbol)),
      );
    });
    client.onError((message) => {
      if (MESSAGE_ERROR.test(message)) return;
      const failure = FAILURES[message] ?? { message: 'The connection to Alpaca failed.', retryable: true };
      connection.failure = failure;
      // ** A refusal on a working connection (symbol limit, missing entitlement) changes no state, so it is
      // reported here; otherwise it would only show as symbols quietly moving to polling.
      if (client.getState() === streaming.STATE.AUTHENTICATED)
        report(channel, 'connected', connection, failure.message);
    });
    client.onStateChange((state) => {
      switch (state) {
        case streaming.STATE.CONNECTING:
          report(channel, connection.attempt > 0 ? 'reconnecting' : 'connecting', connection);
          break;
        case streaming.STATE.AUTHENTICATED:
          connection.attempt = 0;
          connection.failure = null;
          report(channel, 'connected', connection);
          break;
        case streaming.STATE.WAITING_TO_RECONNECT:
          connection.attempt += 1;
          report(channel, 'reconnecting', connection);
          break;
        case streaming.STATE.DISCONNECTED:
          // ** The SDK moves on to "waiting to reconnect" in the same tick when it will retry, so only a
          // close that stays closed is reported.
          queueMicrotask(() => {
            if (client.getState() === streaming.STATE.DISCONNECTED)
              report(channel, 'disconnected', connection);
          });
          break;
        default:
          break;
      }
    });
    client.connect();
    return connection;
  }

  function subscribe(channel: StreamChannel, wanted: readonly string[]): void {
    let connection = connections[channel];
    if (!connection) {
      if (wanted.length === 0) return;
      connection = open(channel);
      connections[channel] = connection;
    }
    const next = new Set(wanted);
    const current = new Set(connection.symbols);
    const added = wanted.filter((symbol) => !current.has(symbol));
    const removed = connection.symbols.filter((symbol) => !next.has(symbol));
    if (removed.length > 0) {
      connection.client.unsubscribeFromTrades(removed);
      connection.client.unsubscribeFromQuotes(removed);
    }
    if (added.length > 0) {
      connection.client.subscribeForTrades(added);
      connection.client.subscribeForQuotes(added);
    }
    connection.symbols = [...wanted];
    // ** A channel that gave up while it had nothing to stream would otherwise stay down once symbols return.
    const stopped = connection.client.getState() === streaming.STATE.DISCONNECTED;
    if (stopped && added.length > 0 && !connection.closing && connection.failure?.retryable !== false) {
      connection.client.connect();
    }
  }

  return {
    setSymbols(symbols) {
      subscribe('stocks', symbols.stocks);
      subscribe('crypto', symbols.crypto);
    },
    reconnect() {
      for (const connection of Object.values(connections)) {
        if (connection.client.getState() !== streaming.STATE.DISCONNECTED || connection.symbols.length === 0)
          continue;
        connection.failure = null;
        connection.closing = false;
        connection.client.connect();
      }
    },
    close() {
      for (const connection of Object.values(connections)) {
        connection.closing = true;
        connection.client.disconnect();
      }
    },
  };
}
