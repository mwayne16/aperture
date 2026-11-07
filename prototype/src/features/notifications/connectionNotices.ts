import type { ConnectionInfo, ConnectionState } from '../../domain/types';
import { formatClock } from '../../lib/format';
import type { AppNotification } from './notificationRules';

/**
 * Turns connection changes into inbox entries. One outage becomes one entry that updates as it
 * goes: lost, then restored. A drop soon after a restore (a flapping connection) reopens the same
 * entry with a drop count, so a flaky feed can't flood the inbox.
 */

/** A drop within this long after the last restore counts as the same outage. */
export const FLAP_WINDOW_MS = 2 * 60_000;

const TIME_ZONE = 'America/New_York';

export interface Outage {
  /** Id of the inbox entry that describes this outage. */
  id: string;
  feedName: string;
  startedAt: number;
  lastDropAt: number;
  drops: number;
  /** When the connection came back, or null while it is down. */
  restoredAt: number | null;
}

/**
 * The outage after a connection change. Returns a new object when its entry should change and the
 * same value otherwise. Only 'reconnecting' counts as a drop: 'disconnected' follows a deliberate
 * disconnect (the app closing), which is not an outage.
 */
export function trackOutage(
  outage: Outage | null,
  previous: ConnectionState,
  info: ConnectionInfo,
  now: number,
  createId: () => string,
): Outage | null {
  if (info.state === 'reconnecting' && previous !== 'reconnecting') {
    if (outage === null) return newOutage(info, now, createId);
    if (outage.restoredAt === null) return outage;
    if (now - outage.restoredAt > FLAP_WINDOW_MS) return newOutage(info, now, createId);
    return { ...outage, drops: outage.drops + 1, lastDropAt: now, restoredAt: null };
  }
  if (info.state === 'connected' && outage !== null && outage.restoredAt === null) {
    return { ...outage, restoredAt: now };
  }
  return outage;
}

function newOutage(info: ConnectionInfo, now: number, createId: () => string): Outage {
  return { id: createId(), feedName: info.feedName, startedAt: now, lastDropAt: now, drops: 1, restoredAt: null };
}

/** "4s", "2m 5s", "1h 3m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** The inbox entry for an outage, as it stands now. */
export function outageNotification(outage: Outage): Omit<AppNotification, 'read'> {
  const since = `${formatClock(outage.startedAt, TIME_ZONE)} ET`;
  const base = { id: outage.id, kind: 'connection' as const, symbol: null };
  if (outage.restoredAt !== null) {
    return {
      ...base,
      title: 'Connection restored',
      body:
        outage.drops === 1
          ? `${outage.feedName} is back after ${formatDuration(outage.restoredAt - outage.startedAt)} offline (lost at ${since}).`
          : `${outage.feedName} dropped ${outage.drops} times since ${since} and is connected again.`,
      at: outage.restoredAt,
    };
  }
  return {
    ...base,
    title: outage.drops === 1 ? 'Connection lost' : 'Connection unstable',
    body:
      outage.drops === 1
        ? `${outage.feedName} stopped at ${since}. Prices may be out of date; retrying automatically.`
        : `${outage.feedName} dropped ${outage.drops} times since ${since}. Prices may be out of date; retrying automatically.`,
    at: outage.lastDropAt,
  };
}
