import type { Instrument } from '@aperture/shared/marketData';
import type {
  BarsRequest,
  MarketDataProvider,
  MarketStream,
  ProviderBar,
  ProviderMovers,
  ProviderSnapshot,
  StreamChannel,
  StreamHandlers,
  StreamStatus,
} from '../marketData/provider.js';

/**
 * A stream that tests drive by hand: they read what was subscribed and push statuses, confirmations and
 * ticks through `handlers`, the callbacks the live service registered.
 */
export class FakeStream implements MarketStream {
  readonly handlers: StreamHandlers;
  readonly subscriptions: Record<StreamChannel, readonly string[]>[] = [];
  reconnects = 0;
  closed = false;

  constructor(handlers: StreamHandlers) {
    this.handlers = handlers;
  }

  setSymbols(symbols: Readonly<Record<StreamChannel, readonly string[]>>): void {
    this.subscriptions.push({ stocks: [...symbols.stocks], crypto: [...symbols.crypto] });
  }

  reconnect(): void {
    this.reconnects += 1;
  }

  close(): void {
    this.closed = true;
  }

  /** Connects a channel and confirms every symbol last subscribed on it. */
  connect(channel: StreamChannel): void {
    this.status(channel, 'connected');
    this.handlers.onSubscribed(channel, [...(this.subscriptions.at(-1)?.[channel] ?? [])]);
  }

  status(
    channel: StreamChannel,
    state: StreamStatus['state'],
    extra: Partial<Pick<StreamStatus, 'reconnectAttempt' | 'error' | 'retryable'>> = {},
  ): void {
    this.handlers.onStatus({ channel, state, reconnectAttempt: 0, error: null, retryable: true, ...extra });
  }
}

const FAKE_INSTRUMENTS: Instrument[] = [
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', assetClass: 'stock' },
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetClass: 'stock' },
  { symbol: 'AAL', name: 'American Airlines Group Inc.', exchange: 'NASDAQ', assetClass: 'stock' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'ARCA', assetClass: 'etf' },
  { symbol: 'BTC/USD', name: 'Bitcoin', exchange: 'CRYPTO', assetClass: 'crypto' },
];

/** A snapshot with every value set, for tests that only care about a few of them. */
export function snapshot(symbol: string, values: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    symbol,
    last: 101,
    lastTradeAt: Date.now() - 1_000,
    bid: 100.9,
    bidSize: 2,
    ask: 101.1,
    askSize: 3,
    quoteAt: Date.now() - 1_000,
    open: 99,
    high: 102,
    low: 98,
    prevClose: 100,
    volume: 5_000,
    ...values,
  };
}

/**
 * An in-memory provider whose answers tests set directly. It records every call, so tests can check
 * what was batched and what was served from a cache. Set `failWith` to make every call reject.
 */
export class FakeProvider implements MarketDataProvider {
  readonly id = 'alpaca' as const;
  readonly limits = {
    requestsPerMinute: 200,
    streamSymbolsPerConnection: { stocks: 30, crypto: 30 },
    streamConnections: 1,
    historyStartMs: Date.UTC(2016, 0, 1),
  };
  feedLabel = 'Fake IEX';
  delayed = false;

  instruments: Instrument[] = FAKE_INSTRUMENTS;
  snapshots = new Map<string, ProviderSnapshot>();
  bars = new Map<string, ProviderBar[]>();
  movers: ProviderMovers = { gainers: [], losers: [], mostActive: [], asOf: 0 };
  failWith: Error | null = null;

  readonly calls = {
    listInstruments: 0,
    getSnapshots: [] as string[][],
    getBars: [] as BarsRequest[],
    getMovers: [] as number[],
  };

  listInstruments(): Promise<Instrument[]> {
    this.calls.listInstruments += 1;
    return this.answer(() => this.instruments.map((i) => ({ ...i })));
  }

  getSnapshots(symbols: readonly string[]): Promise<ProviderSnapshot[]> {
    this.calls.getSnapshots.push([...symbols]);
    return this.answer(() => symbols.flatMap((s) => this.snapshots.get(s) ?? []));
  }

  getBars(request: BarsRequest): Promise<ReadonlyMap<string, ProviderBar[]>> {
    this.calls.getBars.push(request);
    return this.answer(
      () => new Map(request.symbols.flatMap((s) => (this.bars.has(s) ? [[s, this.bars.get(s) ?? []]] : []))),
    );
  }

  getMovers(limit: number): Promise<ProviderMovers> {
    this.calls.getMovers.push(limit);
    return this.answer(() => this.movers);
  }

  /** The stream the live service opened, once it has. */
  stream: FakeStream | null = null;

  openStream(handlers: StreamHandlers): MarketStream {
    this.stream = new FakeStream(handlers);
    return this.stream;
  }

  private answer<T>(value: () => T): Promise<T> {
    return this.failWith === null ? Promise.resolve(value()) : Promise.reject(this.failWith);
  }
}
