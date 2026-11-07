import { evaluateAlert } from '../../domain/alertEngine';
import { normalizeSymbol } from '../../domain/symbols';
import type { AlertEvent, ConnectionInfo, PriceAlert, Quote } from '../../domain/types';
import type { RealtimeClient, Unsubscribe } from '../realtime';
import { STALE_AFTER_MS, type FeedScenario } from '../simulation';
import { createMockMarket, type MockMarket } from './market';
import type { PriceState } from './priceModel';
import { quoteFromState, unavailableQuote } from './quotes';
import { makeId } from './random';
import type { Repository } from './repository';
import { createSimulationSource, type SimulationSource } from './simulationSource';

/**
 * Mock realtime client plus the simulated backend behind it.
 *
 * Backend side: watches "demand" = client subscriptions ∪ symbols of enabled alerts, generates
 * trades for those symbols, evaluates alerts on every new trade, and persists alert state through
 * the shared repository. Client side: coalesces quotes into one batch per FLUSH_INTERVAL_MS (at most
 * one quote per symbol, client-subscribed symbols only), tracks staleness and connection state, and
 * replays a snapshot after every (re)connect.
 */

const TICK_INTERVAL_MS = 100;
export const FLUSH_INTERVAL_MS = 250;
const SWEEP_INTERVAL_MS = 1000;
export const CONNECT_DELAY_MS = 300;
export const DELAYED_FEED_MS = 15 * 60_000;
export const FLAKY_DROP_AFTER_MS = 20_000;
export const FLAKY_RECOVER_AFTER_MS = 4_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
export const FEED_NAME = 'Simulated feed';

/** Delay before reconnect attempt `attempt` (1-based): 1s, 2s, 4s, 8s, 16s, then 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

export interface MockRealtime extends RealtimeClient {
  /** Symbols the simulated backend currently watches upstream. Test and debug aid. */
  getUpstreamSubscriptions(): ReadonlySet<string>;
}

export interface MockRealtimeOptions {
  repo: Repository;
  market?: MockMarket;
  simulation?: SimulationSource;
  now?: () => number;
  /** Picks which symbol gets each simulated trade. Defaults to Math.random. */
  random?: () => number;
  createEventId?: () => string;
  /** Called with each upstream diff (only symbols that actually changed). */
  onUpstreamChange?: (added: readonly string[], removed: readonly string[]) => void;
}

interface BackendEntry {
  quote: Quote;
  /** When the symbol last traded (or when first seen, if it never has). Drives staleness. */
  lastTickAt: number;
  /** Real time of the last trade, before any delayed-feed shift. Null for unknown symbols. */
  tradedAt: number | null;
}

const MESSAGES = {
  outage: 'Simulated outage: the feed is unreachable.',
  drop: 'Simulated network drop.',
} as const;

function clampTicksPerSecond(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.round(value)));
}

export function createMockRealtime(options: MockRealtimeOptions): MockRealtime {
  const { repo } = options;
  const market = options.market ?? createMockMarket();
  const simulation = options.simulation ?? createSimulationSource();
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => Math.random());
  const createEventId = options.createEventId ?? (() => makeId('evt'));

  let connection: ConnectionInfo = {
    state: 'disconnected',
    feedName: FEED_NAME,
    simulated: true,
    lastMessageAt: null,
    reconnectAttempt: 0,
    nextRetryAt: null,
    error: null,
  };
  /** True between connect() and disconnect(): the client wants a connection and retries for one. */
  let active = false;
  let scenario: FeedScenario = simulation.get().feedScenario;

  const clientSubscriptions = new Set<string>();
  const upstream = new Set<string>();
  const backend = new Map<string, BackendEntry>();
  const pending = new Map<string, Quote>();
  /** Last quote delivered to the client per symbol, so a drop can mark them stale. */
  const delivered = new Map<string, Quote>();
  /** Trades owed, in tenths of a trade (ticksPerSecond is added every 100ms). */
  let tradeCarry = 0;

  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let flakyTimer: ReturnType<typeof setTimeout> | null = null;
  let loops: ReturnType<typeof setInterval>[] = [];
  let offSimulation: Unsubscribe | null = null;
  let offRepo: Unsubscribe | null = null;

  const connectionListeners = new Set<(info: ConnectionInfo) => void>();
  const quoteListeners = new Set<(quotes: readonly Quote[]) => void>();
  const alertListeners = new Set<(event: AlertEvent) => void>();
  const alertUpdateListeners = new Set<(alert: PriceAlert) => void>();

  function emit<T>(listeners: Set<(value: T) => void>, value: T): void {
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        // One failing UI listener must not stop the feed or the other listeners.
        console.error('Realtime listener failed', error);
      }
    }
  }

  // Functions, not inline checks, so TypeScript doesn't narrow across listener calls that can disconnect.
  function isConnected(): boolean {
    return connection.state === 'connected';
  }

  function isActive(): boolean {
    return active;
  }

  function setConnection(patch: Partial<ConnectionInfo>): void {
    connection = { ...connection, ...patch };
    emit(connectionListeners, connection);
  }

  function deliver(quotes: Quote[]): void {
    if (quotes.length === 0) return;
    for (const quote of quotes) delivered.set(quote.symbol, quote);
    emit(quoteListeners, Object.freeze(quotes));
  }

  // ---- timers -------------------------------------------------------------------------------

  function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  function stopLoops(): void {
    for (const loop of loops) clearInterval(loop);
    loops = [];
  }

  function startLoops(): void {
    stopLoops();
    tradeCarry = 0;
    loops = [
      setInterval(tick, TICK_INTERVAL_MS),
      setInterval(flush, FLUSH_INTERVAL_MS),
      setInterval(sweep, SWEEP_INTERVAL_MS),
    ];
  }

  function clearAllTimers(): void {
    connectTimer = clearTimer(connectTimer);
    retryTimer = clearTimer(retryTimer);
    flakyTimer = clearTimer(flakyTimer);
    stopLoops();
  }

  // ---- backend: upstream subscriptions ------------------------------------------------------

  /** A quote labeled for the current scenario: 'delayed' shifts the trade time 15 minutes back. */
  function scenarioQuote(state: PriceState, tradedAt: number, at: number): Quote {
    return scenario === 'delayed'
      ? quoteFromState(state, tradedAt - DELAYED_FEED_MS, 'delayed', at)
      : quoteFromState(state, tradedAt, 'live', at);
  }

  /**
   * The provider snapshot taken when the backend starts watching a symbol. Staleness counts from the
   * last trade, so a symbol that hasn't traded recently comes back stale after a reconnect.
   */
  function freshEntry(symbol: string): BackendEntry {
    const at = now();
    const state = market.getState(symbol);
    if (!state) return { quote: unavailableQuote(symbol, at), lastTickAt: at, tradedAt: null };
    const tradedAt = market.lastTradeAt(symbol) ?? at;
    const quote = scenarioQuote(state, tradedAt, at);
    const stale = at - tradedAt >= STALE_AFTER_MS;
    return { quote: stale ? { ...quote, status: 'stale' } : quote, lastTickAt: tradedAt, tradedAt };
  }

  function demand(): Set<string> {
    const symbols = new Set(clientSubscriptions);
    for (const alert of repo.listAlerts()) {
      if (alert.enabled) symbols.add(normalizeSymbol(alert.symbol));
    }
    return symbols;
  }

  function applyUpstreamDiff(target: ReadonlySet<string>): void {
    const removed = [...upstream].filter((s) => !target.has(s));
    const added = [...target].filter((s) => !upstream.has(s));
    for (const symbol of removed) {
      upstream.delete(symbol);
      backend.delete(symbol);
      pending.delete(symbol);
    }
    for (const symbol of added) {
      upstream.add(symbol);
      const entry = freshEntry(symbol);
      backend.set(symbol, entry);
      if (clientSubscriptions.has(symbol)) pending.set(symbol, entry.quote);
    }
    if (added.length > 0 || removed.length > 0) options.onUpstreamChange?.(added, removed);
  }

  /** Upstream follows demand only while connected; otherwise nothing is watched. */
  function syncUpstream(): void {
    applyUpstreamDiff(connection.state === 'connected' ? demand() : new Set());
  }

  // ---- backend: trades and alerts -----------------------------------------------------------

  function tick(): void {
    if (connection.state !== 'connected' || scenario === 'stale' || scenario === 'disconnected') return;
    tradeCarry += clampTicksPerSecond(simulation.get().ticksPerSecond);
    const count = Math.floor(tradeCarry / 10);
    tradeCarry -= count * 10;
    const tradeable = [...upstream].filter((s) => market.isKnown(s));
    if (tradeable.length === 0) return;
    for (let i = 0; i < count; i++) {
      const index = Math.min(tradeable.length - 1, Math.floor(random() * tradeable.length));
      const symbol = tradeable[index];
      if (symbol !== undefined) trade(symbol);
      // An alert listener may have disconnected us mid-loop.
      if (!isConnected()) return;
    }
  }

  function trade(symbol: string): void {
    const at = now();
    const state = market.trade(symbol, at);
    if (!state) return;
    const quote = scenarioQuote(state, at, at);
    backend.set(symbol, { quote, lastTickAt: at, tradedAt: at });
    if (clientSubscriptions.has(symbol)) pending.set(symbol, quote);
    evaluateAlerts(symbol, quote);
  }

  /** Runs only for genuine new trades; snapshots, staleness re-emits and reconnects never get here. */
  function evaluateAlerts(symbol: string, quote: Quote): void {
    if (connection.state !== 'connected') return;
    if (quote.status === 'stale' || quote.status === 'unavailable' || quote.last === null) return;
    const price = quote.last;
    for (const alert of repo.listAlerts()) {
      // A listener may have disconnected us while handling the previous alert.
      if (!isConnected()) return;
      if (!alert.enabled || normalizeSymbol(alert.symbol) !== symbol) continue;
      const result = evaluateAlert(alert, price);
      if (!result.triggered && result.armed === alert.armed) continue;

      let at = now();
      const previous = Date.parse(alert.updatedAt);
      if (Number.isFinite(previous) && previous >= at) at = previous + 1;
      const iso = new Date(at).toISOString();
      const updated: PriceAlert = result.triggered
        ? {
            ...alert,
            armed: result.armed,
            updatedAt: iso,
            lastTriggeredAt: iso,
            lastTriggeredPrice: price,
            triggerCount: alert.triggerCount + 1,
          }
        : { ...alert, armed: result.armed, updatedAt: iso };
      repo.saveAlert(updated);
      emit(alertUpdateListeners, updated);
      if (result.triggered) {
        emit(alertListeners, {
          id: createEventId(),
          alertId: alert.id,
          symbol,
          condition: alert.condition,
          targetPrice: alert.targetPrice,
          tag: alert.tag,
          field: alert.field,
          price,
          triggeredAt: iso,
        });
      }
    }
  }

  // ---- client side: batching and staleness --------------------------------------------------

  function flush(): void {
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending.clear();
    deliver(batch);
  }

  function sweep(): void {
    if (connection.state !== 'connected') return;
    const at = now();
    for (const [symbol, entry] of backend) {
      const status = entry.quote.status;
      if (status !== 'live' && status !== 'delayed') continue;
      if (at - entry.lastTickAt < STALE_AFTER_MS) continue;
      // Re-emitted once: from now on the status is 'stale' until a new trade arrives.
      entry.quote = { ...entry.quote, status: 'stale', updatedAt: at };
      if (clientSubscriptions.has(symbol)) pending.set(symbol, entry.quote);
    }
    // Heartbeat from the simulated backend.
    setConnection({ lastMessageAt: at });
  }

  /** Marks every delivered, subscribed quote stale (used when the connection is lost). */
  function markDeliveredStale(): void {
    const at = now();
    const stale: Quote[] = [];
    for (const symbol of clientSubscriptions) {
      const quote = delivered.get(symbol);
      if (quote && quote.status !== 'stale' && quote.status !== 'unavailable') {
        stale.push({ ...quote, status: 'stale', updatedAt: at });
      }
    }
    deliver(stale);
  }

  /** Re-labels live/delayed quotes after switching between the live and delayed scenarios. */
  function relabelForScenario(): void {
    const at = now();
    for (const [symbol, entry] of backend) {
      if (entry.quote.status !== 'live' && entry.quote.status !== 'delayed') continue;
      const state = market.getState(symbol);
      if (!state || entry.tradedAt === null) continue;
      entry.quote = scenarioQuote(state, entry.tradedAt, at);
      if (clientSubscriptions.has(symbol)) pending.set(symbol, entry.quote);
    }
  }

  // ---- connection lifecycle -----------------------------------------------------------------

  function attempt(): void {
    if (!active) return;
    if (scenario === 'disconnected') {
      scheduleRetry(connection.reconnectAttempt + 1, MESSAGES.outage);
      return;
    }
    onConnected();
  }

  function scheduleRetry(attemptNumber: number, error: string, delay = backoffDelay(attemptNumber)): void {
    retryTimer = clearTimer(retryTimer);
    // Armed before notifying, so a listener that calls disconnect() also clears it.
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attempt();
    }, delay);
    setConnection({
      state: 'reconnecting',
      reconnectAttempt: attemptNumber,
      nextRetryAt: now() + delay,
      error,
    });
  }

  function scheduleFlakyDrop(): void {
    flakyTimer = clearTimer(flakyTimer);
    flakyTimer = setTimeout(() => {
      flakyTimer = null;
      if (connection.state === 'connected' && scenario === 'flaky') {
        drop(MESSAGES.drop, FLAKY_RECOVER_AFTER_MS);
      }
    }, FLAKY_DROP_AFTER_MS);
  }

  function onConnected(): void {
    retryTimer = clearTimer(retryTimer);
    setConnection({
      state: 'connected',
      reconnectAttempt: 0,
      nextRetryAt: null,
      error: null,
      lastMessageAt: now(),
    });
    if (!isActive()) return; // A connection listener called disconnect().
    // Resubscribe, then replay one snapshot batch covering every client subscription.
    syncUpstream();
    const snapshot: Quote[] = [];
    for (const symbol of clientSubscriptions) {
      pending.delete(symbol);
      const entry = backend.get(symbol);
      if (entry) snapshot.push(entry.quote);
    }
    deliver(snapshot);
    if (!isActive()) return; // A quote listener called disconnect().
    startLoops();
    if (scenario === 'flaky') scheduleFlakyDrop();
  }

  /** Connection lost: stop the feed, forget upstream state, mark quotes stale, and retry. */
  function drop(error: string, firstRetryDelay?: number): void {
    stopLoops();
    flakyTimer = clearTimer(flakyTimer);
    pending.clear();
    scheduleRetry(1, error, firstRetryDelay);
    if (!isActive()) return; // disconnect() already cleaned up.
    syncUpstream();
    markDeliveredStale();
  }

  function onScenarioChange(next: FeedScenario): void {
    const previous = scenario;
    if (next === previous) return;
    scenario = next;
    if (!active) return;
    if (connection.state === 'connected') {
      flakyTimer = clearTimer(flakyTimer);
      if (next === 'disconnected') {
        drop(MESSAGES.outage);
        return;
      }
      if (next === 'flaky') scheduleFlakyDrop();
      if ((previous === 'delayed') !== (next === 'delayed')) relabelForScenario();
    } else if (connection.state === 'reconnecting' && next !== 'disconnected') {
      // The reviewer ended the outage: retry now instead of waiting out the backoff.
      retryTimer = clearTimer(retryTimer);
      attempt();
    }
    // While 'connecting', the attempt reads the scenario when the connect delay ends.
  }

  function onRepoChange(): void {
    if (connection.state === 'connected') syncUpstream();
  }

  function subscribe<T>(listeners: Set<T>, listener: T): Unsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    connect() {
      if (active) return;
      active = true;
      scenario = simulation.get().feedScenario;
      offSimulation = simulation.subscribe((state) => {
        onScenarioChange(state.feedScenario);
      });
      offRepo = repo.subscribe(onRepoChange);
      connectTimer = setTimeout(() => {
        connectTimer = null;
        attempt();
      }, CONNECT_DELAY_MS);
      setConnection({ state: 'connecting', reconnectAttempt: 0, nextRetryAt: null, error: null });
    },

    disconnect() {
      if (!active) return;
      active = false;
      clearAllTimers();
      offSimulation?.();
      offRepo?.();
      offSimulation = null;
      offRepo = null;
      pending.clear();
      setConnection({ state: 'disconnected', reconnectAttempt: 0, nextRetryAt: null, error: null });
      syncUpstream();
      markDeliveredStale();
    },

    setSubscriptions(symbols) {
      const next = new Set<string>();
      for (const raw of symbols as readonly unknown[]) {
        if (typeof raw !== 'string') continue;
        const symbol = normalizeSymbol(raw);
        if (symbol !== '') next.add(symbol);
      }
      const added = [...next].filter((s) => !clientSubscriptions.has(s));
      const removed = [...clientSubscriptions].filter((s) => !next.has(s));
      if (added.length === 0 && removed.length === 0) return;
      for (const symbol of removed) {
        clientSubscriptions.delete(symbol);
        pending.delete(symbol);
      }
      for (const symbol of added) clientSubscriptions.add(symbol);

      if (connection.state === 'connected') {
        syncUpstream();
        // Symbols already watched for alerts still need a first quote on the client.
        for (const symbol of added) {
          const entry = backend.get(symbol);
          if (entry) pending.set(symbol, entry.quote);
        }
      } else {
        // No feed: anything the client already shows for a re-added symbol is out of date.
        const at = now();
        const stale: Quote[] = [];
        for (const symbol of added) {
          const quote = delivered.get(symbol);
          if (quote && quote.status !== 'stale' && quote.status !== 'unavailable') {
            stale.push({ ...quote, status: 'stale', updatedAt: at });
          }
        }
        deliver(stale);
      }
    },

    getConnection: () => connection,
    getUpstreamSubscriptions: () => new Set(upstream),
    onConnection: (listener) => subscribe(connectionListeners, listener),
    onQuotes: (listener) => subscribe(quoteListeners, listener),
    onAlert: (listener) => subscribe(alertListeners, listener),
    onAlertUpdated: (listener) => subscribe(alertUpdateListeners, listener),
  };
}
