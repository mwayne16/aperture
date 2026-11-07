import type { ConnectionInfo, DataStatus } from '../../domain/types';
import { formatAge } from '../../lib/format';

/** Feed-wide freshness of the quotes on screen. 'none' means no subscribed symbol has a usable quote. */
export type QuoteFreshness = 'live' | 'delayed' | 'stale' | 'none';

/**
 * Summarizes the statuses of the subscribed symbols' quotes. Any delayed quote marks the whole feed
 * delayed, since delay is a property of the provider or plan. Otherwise one live quote is enough to
 * call it live (thinly traded symbols go stale on their own), and it is stale only when nothing is live.
 */
export function quoteFreshness(statuses: Iterable<DataStatus | undefined>): QuoteFreshness {
  let live = false;
  let stale = false;
  for (const status of statuses) {
    if (status === 'delayed') return 'delayed';
    if (status === 'live') live = true;
    else if (status === 'stale') stale = true;
  }
  if (live) return 'live';
  return stale ? 'stale' : 'none';
}

type ConnectionTone = 'gain' | 'warning' | 'loss' | 'accent';

interface DataNote {
  label: string;
  description: string;
}

interface ConnectionView {
  tone: ConnectionTone;
  /** Short state label, e.g. "Connected" or "Reconnecting (attempt 3)". */
  label: string;
  /** The halo means updates are flowing, so it only shows while connected with live quotes. */
  pulse: boolean;
  /** Data-quality warning while connected, e.g. delayed or stale quotes. */
  dataNote: DataNote | null;
}

const DATA_NOTES: Partial<Record<QuoteFreshness, DataNote>> = {
  delayed: { label: 'Delayed', description: 'Quotes are delayed, not real time.' },
  stale: { label: 'Stale', description: 'Quotes have stopped updating.' },
};

/** How the connection reads in the chrome: dot tone, label and any data-quality note. */
export function describeConnection(info: ConnectionInfo, freshness: QuoteFreshness): ConnectionView {
  switch (info.state) {
    case 'connecting':
      return { tone: 'accent', label: 'Connecting…', pulse: false, dataNote: null };
    case 'connected':
      return {
        tone: 'gain',
        label: 'Connected',
        pulse: freshness === 'live',
        dataNote: DATA_NOTES[freshness] ?? null,
      };
    case 'reconnecting':
      return {
        tone: 'warning',
        label: info.reconnectAttempt > 0 ? `Reconnecting (attempt ${info.reconnectAttempt})` : 'Reconnecting…',
        pulse: false,
        dataNote: null,
      };
    case 'disconnected':
      return { tone: 'loss', label: 'Disconnected', pulse: false, dataNote: null };
  }
}

/**
 * Countdown to the next reconnect attempt: "Next retry in 4s", "Next retry in 1m 05s", "Retrying now".
 * Rounds to the nearest second: `now` advances once a second, so it can be up to a second old when the
 * connection changes, and rounding up would then show a fresh 4s backoff as "5s".
 */
export function formatRetry(nextRetryAt: number, now: number): string {
  const seconds = Math.round((nextRetryAt - now) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Retrying now';
  if (seconds < 60) return `Next retry in ${seconds}s`;
  const rest = String(seconds % 60).padStart(2, '0');
  return `Next retry in ${Math.floor(seconds / 60)}m ${rest}s`;
}

/** "Last message 3s ago", or "No messages yet" before the backend has sent anything. */
export function formatLastMessage(lastMessageAt: number | null, now: number): string {
  return lastMessageAt === null ? 'No messages yet' : `Last message ${formatAge(lastMessageAt, now)}`;
}

/** Secondary lines for the connection tooltip: feed, last message, retry countdown and last error. */
export function connectionDetails(info: ConnectionInfo, now: number): string[] {
  const lines = [info.feedName, formatLastMessage(info.lastMessageAt, now)];
  if (info.state === 'reconnecting' && info.nextRetryAt !== null) lines.push(formatRetry(info.nextRetryAt, now));
  if (info.error) lines.push(info.error);
  return lines;
}
