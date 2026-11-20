import type { FeedChannelStatus, MarketDataStatus, Quote } from '@aperture/shared/marketData';
import type { FastifyBaseLogger } from 'fastify';
import { MarketState } from './marketState.js';
import {
  isCryptoSymbol,
  ProviderError,
  STREAM_CHANNELS,
  type MarketDataProvider,
  type MarketStream,
  type StreamChannel,
  type StreamStatus,
} from './provider.js';
import { toQuote } from './quotes.js';
import { planSubscriptions, type Demand, type SubscriptionPlan } from './streamPlan.js';

/** How often symbols without a live stream are refreshed: one batched snapshot request per round. */
export const POLL_INTERVAL_MS = 15_000;
/** Streamed symbols still get a snapshot this often, for the day's volume and range. */
const BASELINE_MAX_AGE_MS = 60_000;
/** A connection that stopped retrying is tried again after this long. */
export const RECOVERY_DELAY_MS = 5 * 60_000;

export interface LiveMarketDataOptions {
  /** The symbols that need prices right now. */
  demand: () => Promise<Demand>;
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>;
  now?: () => number;
}

/** A newer trade price for a symbol: `time` is when the trade happened, in epoch ms. */
export interface PriceUpdate {
  symbol: string;
  price: number;
  time: number;
}

type PriceListener = (update: PriceUpdate) => void;

interface Channel {
  status: StreamStatus;
  lastMessageAt: number | null;
  /** Symbols the provider confirmed. Only these count as streamed. */
  confirmed: Set<string>;
  recovery: ReturnType<typeof setTimeout> | null;
}

const EMPTY_PLAN: SubscriptionPlan = { streamed: { stocks: [], crypto: [] }, polled: [] };

function idle(channel: StreamChannel): StreamStatus {
  return { channel, state: 'idle', reconnectAttempt: 0, error: null, retryable: true };
}

/** Failure text that is safe to show: provider errors carry their own; anything else stays in the log. */
function describe(error: unknown): string {
  return error instanceof ProviderError ? error.message : 'Unexpected error; see the server log.';
}

/**
 * Keeps the latest prices for every symbol that needs them. Symbols in the plan's streams arrive live;
 * the rest, and any whose connection is down, are polled with one batched snapshot request per round.
 * Streamed symbols also get a periodic snapshot for the day's volume and range. Nothing here throws:
 * failures are logged and reported by `status()`, and quotes fall back to the REST path.
 */
export class LiveMarketData {
  private readonly provider: MarketDataProvider;
  private readonly options: LiveMarketDataOptions;
  private readonly now: () => number;
  private readonly state = new MarketState();
  private readonly channels: Record<StreamChannel, Channel> = {
    stocks: { status: idle('stocks'), lastMessageAt: null, confirmed: new Set(), recovery: null },
    crypto: { status: idle('crypto'), lastMessageAt: null, confirmed: new Set(), recovery: null },
  };
  private stream: MarketStream | null = null;
  private plan: SubscriptionPlan = EMPTY_PLAN;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> | null = null;
  /** Poll rounds asked for; a running round repeats until it has covered the latest request. */
  private pollRequests = 0;
  private refreshing: Promise<void> | null = null;
  /** Refreshes asked for, counted the same way. */
  private refreshRequests = 0;
  private lastPollAt: number | null = null;
  private pollError: string | null = null;
  private stopped = false;
  private readonly priceListeners = new Set<PriceListener>();

  constructor(provider: MarketDataProvider, options: LiveMarketDataOptions) {
    this.provider = provider;
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Opens the stream, loads demand and starts polling. Never rejects. */
  async start(): Promise<void> {
    if (this.stream !== null || this.stopped) return;
    this.stream = this.provider.openStream({
      onTrade: (trade) => {
        if (this.state.applyTrade(trade)) this.publishPrice(trade.symbol, trade.price, trade.time);
        this.received(trade.symbol);
      },
      onQuote: (quote) => {
        this.state.applyQuote(quote);
        this.received(quote.symbol);
      },
      onStatus: (status) => {
        this.statusChanged(status);
      },
      onSubscribed: (channel, symbols) => {
        this.channels[channel].confirmed = new Set(symbols);
      },
    });
    this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    await this.refresh();
  }

  /**
   * Calls `listener` with every newer trade price for a tracked symbol, live or polled. A polled symbol's
   * first snapshot counts as a new price, so alerts are checked once its value is known. Returns a function
   * that removes the listener.
   */
  onPrice(listener: PriceListener): () => void {
    this.priceListeners.add(listener);
    return () => this.priceListeners.delete(listener);
  }

  /** Stops polling and closes the stream. */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    for (const channel of STREAM_CHANNELS) this.clearRecovery(channel);
    this.stream?.close();
    this.stream = null;
  }

  /**
   * Reloads demand and updates the streams and polling to match. Calls made while a refresh runs are
   * folded into one more run, so a burst of watchlist changes costs at most two. Never rejects.
   */
  refresh(): Promise<void> {
    this.refreshRequests += 1;
    if (this.refreshing !== null) {
      return this.refreshing;
    }
    this.refreshing = this.refreshUntilSettled().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The symbol's quote when it is current (streamed, or polled within two rounds), otherwise null. */
  quote(symbol: string): Quote | null {
    const values = this.state.get(symbol);
    if (values?.baselineAt == null) return null;
    const now = this.now();
    const current = this.isStreamed(symbol) || now - values.baselineAt < 2 * POLL_INTERVAL_MS;
    return current ? toQuote(symbol, values, this.provider.delayed, now) : null;
  }

  status(): MarketDataStatus {
    return {
      configured: true,
      feedName: this.provider.feedLabel,
      delayed: this.provider.delayed,
      stocks: this.channelStatus('stocks'),
      crypto: this.channelStatus('crypto'),
      polled: this.tracked().filter((symbol) => !this.isStreamed(symbol)),
      lastPollAt: this.lastPollAt,
      pollError: this.pollError,
    };
  }

  private async refreshUntilSettled(): Promise<void> {
    let handled: number;
    do {
      handled = this.refreshRequests;
      try {
        const demand = await this.options.demand();
        if (this.stopped) return;
        this.plan = planSubscriptions(demand, this.provider.limits.streamSymbolsPerConnection);
        this.state.track(this.tracked());
        this.stream?.setSymbols(this.plan.streamed);
        // ** New symbols need a baseline (previous close, day range) before they can be served.
        await this.poll();
      } catch {
        this.options.log.warn('Could not load the symbols that need prices; keeping the current ones');
      }
    } while (handled !== this.refreshRequests && !this.stopped);
  }

  /** Runs a poll round, or schedules one more if a round is already running. */
  private poll(): Promise<void> {
    this.pollRequests += 1;
    if (this.polling !== null) return this.polling;
    this.polling = (async () => {
      let handled: number;
      do {
        handled = this.pollRequests;
        await this.pollOnce();
      } while (handled !== this.pollRequests && !this.stopped);
    })().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  /** One snapshot request for every tracked symbol that is due: unstreamed ones always, streamed ones once a minute. */
  private async pollOnce(): Promise<void> {
    const now = this.now();
    const due = this.tracked().filter((symbol) => {
      if (!this.isStreamed(symbol)) return true;
      const baselineAt = this.state.get(symbol)?.baselineAt ?? null;
      return baselineAt === null || now - baselineAt >= BASELINE_MAX_AGE_MS;
    });
    if (due.length === 0 || this.stopped) return;
    try {
      const snapshots = await this.provider.getSnapshots(due);
      const at = this.now();
      for (const snapshot of snapshots) {
        if (this.state.applySnapshot(snapshot, at) && snapshot.last !== null) {
          this.publishPrice(snapshot.symbol, snapshot.last, snapshot.lastTradeAt ?? at);
        }
      }
      this.lastPollAt = at;
      if (this.pollError !== null) this.options.log.info('Polling market data works again');
      this.pollError = null;
    } catch (error) {
      const reason = describe(error);
      // ** A lasting failure (e.g. rejected keys) would otherwise repeat the same warning every round.
      if (reason !== this.pollError) this.options.log.warn({ reason }, 'Polling market data failed');
      this.pollError = reason;
    }
  }

  private statusChanged(status: StreamStatus): void {
    if (this.stopped) return;
    const channel = this.channels[status.channel];
    const previous = channel.status;
    channel.status = status;
    if (status.state === 'connected') {
      this.clearRecovery(status.channel);
      if (status.error !== null && status.error !== previous.error) {
        this.options.log.warn(
          { channel: status.channel, reason: status.error },
          'Market data stream refused a request',
        );
      }
      if (previous.state !== 'connected')
        this.options.log.info({ channel: status.channel }, 'Market data stream connected');
      return;
    }
    if (previous.state === 'connected') {
      // ** Symbols on a dropped connection are polled until it is back, so their prices stay current.
      channel.confirmed = new Set();
      void this.poll();
    }
    if (status.state === 'reconnecting' || status.state === 'disconnected') {
      this.options.log.warn(
        {
          channel: status.channel,
          state: status.state,
          attempt: status.reconnectAttempt,
          reason: status.error,
        },
        'Market data stream not connected',
      );
    }
    const failed = status.state === 'disconnected' && status.error !== null;
    if (failed && status.retryable && channel.recovery === null) {
      channel.recovery = setTimeout(() => {
        channel.recovery = null;
        this.stream?.reconnect();
      }, RECOVERY_DELAY_MS);
    }
  }

  private clearRecovery(channel: StreamChannel): void {
    const timer = this.channels[channel].recovery;
    if (timer !== null) clearTimeout(timer);
    this.channels[channel].recovery = null;
  }

  private publishPrice(symbol: string, price: number, time: number): void {
    for (const listener of this.priceListeners) {
      try {
        listener({ symbol, price, time });
      } catch {
        // ** One failing listener must not stop the others or the stream.
        this.options.log.warn({ symbol }, 'A price listener failed');
      }
    }
  }

  private received(symbol: string): void {
    this.channels[isCryptoSymbol(symbol) ? 'crypto' : 'stocks'].lastMessageAt = this.now();
  }

  private isStreamed(symbol: string): boolean {
    const channel = this.channels[isCryptoSymbol(symbol) ? 'crypto' : 'stocks'];
    return channel.status.state === 'connected' && channel.confirmed.has(symbol);
  }

  private tracked(): string[] {
    return [...this.plan.streamed.stocks, ...this.plan.streamed.crypto, ...this.plan.polled];
  }

  private channelStatus(name: StreamChannel): FeedChannelStatus {
    const channel = this.channels[name];
    return {
      state: channel.status.state,
      reconnectAttempt: channel.status.reconnectAttempt,
      error: channel.status.error,
      lastMessageAt: channel.lastMessageAt,
      streamed: channel.status.state === 'connected' ? [...channel.confirmed] : [],
    };
  }
}
