import { describe, expect, it } from 'vitest';
import type { Quote } from '../../domain/types';
import { awaitingQuote, connectionNotice, describeStatus, liveLine, quoteStats, quoteTime } from './quoteView';

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL',
    last: 189.12,
    lastTradeAt: 1_000,
    bid: 189.1,
    bidSize: 300,
    ask: 189.14,
    askSize: 1_200,
    quoteAt: 900,
    open: 187.5,
    high: 190,
    low: 186.75,
    prevClose: 188,
    volume: 48_250_000,
    change: 1.12,
    changePct: 0.6,
    status: 'live',
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('describeStatus', () => {
  it('labels every data status', () => {
    expect(describeStatus('live')).toMatchObject({ label: 'Live', tone: 'gain', pulse: true });
    expect(describeStatus('delayed')).toMatchObject({ label: 'Delayed', tone: 'warning', pulse: false });
    expect(describeStatus('stale')).toMatchObject({ label: 'Stale', tone: 'muted', pulse: false });
    expect(describeStatus('unavailable')).toMatchObject({ label: 'Unavailable', tone: 'loss', pulse: false });
  });
});

describe('quoteTime', () => {
  it('prefers the last trade and falls back to the bid/ask time', () => {
    expect(quoteTime(quote())).toBe(1_000);
    expect(quoteTime(quote({ lastTradeAt: null }))).toBe(900);
    expect(quoteTime(quote({ lastTradeAt: null, quoteAt: null }))).toBeNull();
  });
});

describe('quoteStats', () => {
  it('formats every stat in display order', () => {
    expect(quoteStats(quote())).toEqual([
      { label: 'Open', value: '187.50' },
      { label: 'Prev close', value: '188.00' },
      { label: 'High', value: '190.00' },
      { label: 'Low', value: '186.75' },
      { label: 'Bid', value: '189.10 × 300' },
      { label: 'Ask', value: '189.14 × 1.20K' },
      { label: 'Spread', value: '0.0400' },
      { label: 'Volume', value: '48.3M' },
    ]);
  });

  it('shows dashes before the first quote', () => {
    expect(quoteStats(undefined).every((stat) => stat.value === '—')).toBe(true);
  });

  it('shows a price without a size, and no spread for a missing or crossed side', () => {
    const stats = quoteStats(quote({ bidSize: null, ask: null }));
    expect(stats.find((s) => s.label === 'Bid')?.value).toBe('189.10');
    expect(stats.find((s) => s.label === 'Ask')?.value).toBe('—');
    expect(stats.find((s) => s.label === 'Spread')?.value).toBe('—');
    const crossed = quoteStats(quote({ bid: 190, ask: 189 }));
    expect(crossed.find((s) => s.label === 'Spread')?.value).toBe('—');
  });
});

describe('liveLine', () => {
  it('draws the last price labeled by its status', () => {
    expect(liveLine(quote())).toEqual({ price: 189.12, label: 'Live', muted: false });
    expect(liveLine(quote({ status: 'delayed' }))).toEqual({ price: 189.12, label: 'Delayed', muted: false });
    expect(liveLine(quote({ status: 'stale' }))).toEqual({ price: 189.12, label: 'Stale', muted: true });
  });

  it('draws nothing without a usable price', () => {
    expect(liveLine(undefined)).toBeNull();
    expect(liveLine(quote({ last: null }))).toBeNull();
    expect(liveLine(quote({ status: 'unavailable' }))).toBeNull();
  });
});

describe('awaitingQuote', () => {
  it('expects a quote only while the feed is connecting or connected', () => {
    expect(awaitingQuote('connecting')).toBe(true);
    expect(awaitingQuote('connected')).toBe(true);
    expect(awaitingQuote('reconnecting')).toBe(false);
    expect(awaitingQuote('disconnected')).toBe(false);
  });
});

describe('connectionNotice', () => {
  it('stays quiet while connected', () => {
    expect(connectionNotice('connected', true)).toBeNull();
    expect(connectionNotice('connected', false)).toBeNull();
  });

  it('only mentions connecting when there is nothing to show yet', () => {
    expect(connectionNotice('connecting', true)).toBeNull();
    expect(connectionNotice('connecting', false)).toBe('Connecting to the feed…');
  });

  it('explains what is shown while the feed is down', () => {
    expect(connectionNotice('disconnected', true)).toBe('The feed is disconnected. Showing the last quote received.');
    expect(connectionNotice('reconnecting', false)).toBe('Reconnecting to the feed. No quote yet.');
  });
});
