import type { AlertEvent, PriceAlert } from './alerts.js';
import type { MarketDataStatus, Quote } from './marketData.js';

/**
 * The WebSocket protocol between the app and the server, at `REALTIME_PATH`. Messages are JSON objects
 * with a `type`. The app keeps one connection, sends which symbols it shows, and receives their quotes,
 * the server's market-data status and alert events. After connecting or reconnecting, the app subscribes
 * again and gets a snapshot of every symbol, so it recovers without the messages it missed.
 */

export const REALTIME_PATH = '/realtime';

/** Symbols one connection may subscribe to at once. */
export const MAX_REALTIME_SUBSCRIPTIONS = 200;

/** The largest message the server accepts from the app, in bytes. */
export const MAX_REALTIME_MESSAGE_BYTES = 16 * 1024;

// ---- App to server -------------------------------------------------------------------------------

/** Adds symbols to this connection's subscriptions. The server answers with a quote batch for them. */
export interface SubscribeMessage {
  type: 'subscribe';
  symbols: string[];
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  symbols: string[];
}

/** The symbol whose page is open, or null. It gets a live stream ahead of alerts when there's room. */
export interface FocusMessage {
  type: 'focus';
  symbol: string | null;
}

export type RealtimeClientMessage = SubscribeMessage | UnsubscribeMessage | FocusMessage;

// ---- Server to app -------------------------------------------------------------------------------

/**
 * Quotes for subscribed symbols, at most one per symbol. Each is the symbol's full latest quote, not a
 * change. Batches are sent a few times a second at most; a subscribe answers at once.
 */
export interface QuotesMessage {
  type: 'quotes';
  quotes: Quote[];
}

/** How the server gets prices. Sent on connect and whenever it changes. */
export interface StatusMessage {
  type: 'status';
  status: MarketDataStatus;
}

/** An alert fired. Sent once per trigger; the app de-duplicates by `event.id` across reconnects. */
export interface AlertMessage {
  type: 'alert';
  event: AlertEvent;
}

/** An alert's saved state changed because it fired or re-armed. */
export interface AlertUpdatedMessage {
  type: 'alertUpdated';
  alert: PriceAlert;
}

/** The server couldn't use a message from the app. The connection stays open. */
export interface RealtimeErrorMessage {
  type: 'error';
  message: string;
}

export type RealtimeServerMessage =
  | QuotesMessage
  | StatusMessage
  | AlertMessage
  | AlertUpdatedMessage
  | RealtimeErrorMessage;
