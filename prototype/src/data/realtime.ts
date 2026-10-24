import type { AlertEvent, ConnectionInfo, PriceAlert, Quote } from '../domain/types';

export type Unsubscribe = () => void;

/**
 * Mirrors the future WebSocket client. The prototype implements it in `mock/mockRealtime.ts`.
 *
 * Contract:
 * - One connection for the whole app. Components never open their own.
 * - `setSubscriptions` replaces the desired symbol set. Duplicates are ignored, and only the
 *   difference is sent upstream.
 * - Quote updates arrive in batches with at most one quote per symbol (coalesced). Each quote is a
 *   full snapshot for that symbol, not a delta.
 * - After every (re)connect the client resubscribes and emits one snapshot batch covering all
 *   subscribed symbols, so state recovers without relying on missed events.
 * - Alerts are evaluated on the backend side. `onAlert` delivers each trigger once per event id.
 *   `onAlertUpdated` delivers the alert's new persisted state (armed, lastTriggeredAt, etc.).
 */
export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  setSubscriptions(symbols: readonly string[]): void;
  getConnection(): ConnectionInfo;
  onConnection(listener: (info: ConnectionInfo) => void): Unsubscribe;
  onQuotes(listener: (quotes: readonly Quote[]) => void): Unsubscribe;
  onAlert(listener: (event: AlertEvent) => void): Unsubscribe;
  onAlertUpdated(listener: (alert: PriceAlert) => void): Unsubscribe;
}
