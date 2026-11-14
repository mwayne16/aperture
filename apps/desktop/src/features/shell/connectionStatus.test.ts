import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTION } from '../../data/connectionStore';
import type { ConnectionInfo } from '../../domain/types';
import {
  connectionDetails,
  describeConnection,
  formatLastMessage,
  formatRetry,
  quoteFreshness,
} from './connectionStatus';

const NOW = Date.UTC(2026, 9, 28, 15, 0);

function connection(patch: Partial<ConnectionInfo>): ConnectionInfo {
  return { ...INITIAL_CONNECTION, ...patch };
}

describe('quoteFreshness', () => {
  it('is none when nothing is subscribed or no quote has arrived yet', () => {
    expect(quoteFreshness([])).toBe('none');
    expect(quoteFreshness([undefined, 'unavailable'])).toBe('none');
  });

  it('marks the whole feed delayed when any quote is delayed', () => {
    expect(quoteFreshness(['live', 'delayed', 'stale'])).toBe('delayed');
    expect(quoteFreshness(['stale', 'delayed'])).toBe('delayed');
  });

  it('stays live while at least one quote is live, even if quiet symbols went stale', () => {
    expect(quoteFreshness(['stale', 'live', 'stale'])).toBe('live');
  });

  it('is stale only when every usable quote is stale', () => {
    expect(quoteFreshness(['stale', 'stale', undefined])).toBe('stale');
  });
});

describe('describeConnection', () => {
  it('labels each connection state', () => {
    expect(describeConnection(connection({ state: 'connecting' }), 'none')).toMatchObject({
      tone: 'accent',
      label: 'Connecting…',
    });
    expect(describeConnection(connection({ state: 'disconnected' }), 'stale')).toMatchObject({
      tone: 'loss',
      label: 'Disconnected',
      dataNote: null,
    });
  });

  it('shows the reconnect attempt number', () => {
    const view = describeConnection(connection({ state: 'reconnecting', reconnectAttempt: 3 }), 'stale');
    expect(view).toMatchObject({ tone: 'warning', label: 'Reconnecting (attempt 3)', pulse: false });
    expect(describeConnection(connection({ state: 'reconnecting' }), 'none').label).toBe('Reconnecting…');
  });

  it('pulses only while connected with live quotes', () => {
    expect(describeConnection(connection({ state: 'connected' }), 'live')).toEqual({
      tone: 'gain',
      label: 'Connected',
      pulse: true,
      dataNote: null,
    });
    expect(describeConnection(connection({ state: 'connected' }), 'none').pulse).toBe(false);
  });

  it('flags delayed and stale quotes while connected', () => {
    expect(describeConnection(connection({ state: 'connected' }), 'delayed')).toMatchObject({
      pulse: false,
      dataNote: { label: 'Delayed' },
    });
    expect(describeConnection(connection({ state: 'connected' }), 'stale').dataNote?.label).toBe('Stale');
  });
});

describe('formatRetry', () => {
  it('counts down in whole seconds, rounded to the nearest', () => {
    expect(formatRetry(NOW + 4000, NOW)).toBe('Next retry in 4s');
    // A fresh 4s backoff seen from a `now` that is 400ms old still reads 4s.
    expect(formatRetry(NOW + 4400, NOW)).toBe('Next retry in 4s');
    expect(formatRetry(NOW + 30_000, NOW)).toBe('Next retry in 30s');
  });

  it('switches to minutes for long backoffs', () => {
    expect(formatRetry(NOW + 65_000, NOW)).toBe('Next retry in 1m 05s');
  });

  it('says retrying now once the moment has passed', () => {
    expect(formatRetry(NOW, NOW)).toBe('Retrying now');
    expect(formatRetry(NOW + 400, NOW)).toBe('Retrying now');
    expect(formatRetry(NOW - 500, NOW)).toBe('Retrying now');
  });
});

describe('formatLastMessage', () => {
  it('reads the age of the last message, or says none arrived', () => {
    expect(formatLastMessage(null, NOW)).toBe('No messages yet');
    expect(formatLastMessage(NOW - 500, NOW)).toBe('Last message just now');
    expect(formatLastMessage(NOW - 12_000, NOW)).toBe('Last message 12s ago');
  });
});

describe('connectionDetails', () => {
  it('lists the feed and last message while connected', () => {
    expect(connectionDetails(connection({ state: 'connected', lastMessageAt: NOW - 3000 }), NOW)).toEqual([
      'Simulated feed',
      'Last message 3s ago',
    ]);
  });

  it('adds the retry countdown and the error while reconnecting', () => {
    const info = connection({
      state: 'reconnecting',
      reconnectAttempt: 2,
      nextRetryAt: NOW + 2000,
      lastMessageAt: NOW - 8000,
      error: 'Simulated network drop.',
    });
    expect(connectionDetails(info, NOW)).toEqual([
      'Simulated feed',
      'Last message 8s ago',
      'Next retry in 2s',
      'Simulated network drop.',
    ]);
  });
});
