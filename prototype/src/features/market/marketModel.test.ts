import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTION } from '../../data/connectionStore';
import type { ConnectionInfo, Quote } from '../../domain/types';
import {
  connectionNotice,
  flashDirection,
  moveSymbol,
  navigationTarget,
  neighborAfterRemoval,
  quoteDataTime,
  quoteStatusView,
  retryCountdown,
} from './marketModel';

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA'];

describe('moveSymbol', () => {
  it('moves a symbol one place up or down', () => {
    expect(moveSymbol(SYMBOLS, 'MSFT', -1)).toEqual(['MSFT', 'AAPL', 'NVDA']);
    expect(moveSymbol(SYMBOLS, 'MSFT', 1)).toEqual(['AAPL', 'NVDA', 'MSFT']);
  });

  it('returns null at the ends and for a symbol not in the list', () => {
    expect(moveSymbol(SYMBOLS, 'AAPL', -1)).toBeNull();
    expect(moveSymbol(SYMBOLS, 'NVDA', 1)).toBeNull();
    expect(moveSymbol(SYMBOLS, 'TSLA', 1)).toBeNull();
  });

  it('does not change the input list', () => {
    const symbols = [...SYMBOLS];
    moveSymbol(symbols, 'AAPL', 1);
    expect(symbols).toEqual(SYMBOLS);
  });
});

describe('navigationTarget', () => {
  it('moves one row with the arrows and stops at the ends', () => {
    expect(navigationTarget(SYMBOLS, 'MSFT', 'ArrowDown', true)).toBe('NVDA');
    expect(navigationTarget(SYMBOLS, 'MSFT', 'ArrowUp', true)).toBe('AAPL');
    expect(navigationTarget(SYMBOLS, 'NVDA', 'ArrowDown', true)).toBe('NVDA');
    expect(navigationTarget(SYMBOLS, 'AAPL', 'ArrowUp', true)).toBe('AAPL');
  });

  it('jumps to the first and last row with Home and End', () => {
    expect(navigationTarget(SYMBOLS, 'MSFT', 'Home', true)).toBe('AAPL');
    expect(navigationTarget(SYMBOLS, 'MSFT', 'End', true)).toBe('NVDA');
  });

  it('selects the focused row first when it is not selected yet', () => {
    expect(navigationTarget(SYMBOLS, 'AAPL', 'ArrowDown', false)).toBe('AAPL');
  });

  it('starts from an end when the focused row has left the list', () => {
    expect(navigationTarget(SYMBOLS, 'TSLA', 'ArrowDown', true)).toBe('AAPL');
    expect(navigationTarget(SYMBOLS, 'TSLA', 'ArrowUp', true)).toBe('NVDA');
  });

  it('returns null for an empty list', () => {
    expect(navigationTarget([], 'AAPL', 'Home', true)).toBeNull();
  });
});

describe('neighborAfterRemoval', () => {
  it('prefers the next row, then the previous one', () => {
    expect(neighborAfterRemoval(SYMBOLS, 'MSFT')).toBe('NVDA');
    expect(neighborAfterRemoval(SYMBOLS, 'NVDA')).toBe('MSFT');
  });

  it('returns null when the list will be empty or the symbol is missing', () => {
    expect(neighborAfterRemoval(['AAPL'], 'AAPL')).toBeNull();
    expect(neighborAfterRemoval(SYMBOLS, 'TSLA')).toBeNull();
  });
});

describe('flashDirection', () => {
  it('flashes up or down only when a known price changes', () => {
    expect(flashDirection(10, 10.01)).toBe('up');
    expect(flashDirection(10, 9.99)).toBe('down');
    expect(flashDirection(10, 10)).toBeNull();
    expect(flashDirection(null, 10)).toBeNull();
    expect(flashDirection(10, null)).toBeNull();
  });
});

function quote(patch: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL',
    last: 100,
    lastTradeAt: 1_000,
    bid: 99.9,
    bidSize: 100,
    ask: 100.1,
    askSize: 100,
    quoteAt: 2_000,
    open: 99,
    high: 101,
    low: 98,
    prevClose: 99,
    volume: 1_000_000,
    change: 1,
    changePct: 1.01,
    status: 'live',
    updatedAt: 3_000,
    ...patch,
  };
}

describe('quoteStatusView', () => {
  it('labels every data status and greys stale and unavailable values', () => {
    expect(quoteStatusView(quote({ status: 'live' }), 'connected')).toEqual({
      label: 'Live',
      tone: 'gain',
      dimmed: false,
    });
    expect(quoteStatusView(quote({ status: 'delayed' }), 'connected')).toMatchObject({
      label: 'Delayed',
      dimmed: false,
    });
    expect(quoteStatusView(quote({ status: 'stale' }), 'reconnecting')).toMatchObject({
      label: 'Stale',
      tone: 'warning',
      dimmed: true,
    });
    expect(quoteStatusView(quote({ status: 'unavailable' }), 'connected')).toMatchObject({
      label: 'Unavailable',
      dimmed: true,
    });
  });

  it('waits for a first quote while connected, and reports no data while disconnected', () => {
    expect(quoteStatusView(undefined, 'connecting').label).toBe('Waiting');
    expect(quoteStatusView(undefined, 'connected').label).toBe('Waiting');
    expect(quoteStatusView(undefined, 'reconnecting').label).toBe('No data');
    expect(quoteStatusView(undefined, 'disconnected').label).toBe('No data');
  });
});

describe('quoteDataTime', () => {
  it('uses the last trade time, then the quote time', () => {
    expect(quoteDataTime(quote())).toBe(1_000);
    expect(quoteDataTime(quote({ lastTradeAt: null }))).toBe(2_000);
    expect(quoteDataTime(quote({ lastTradeAt: null, quoteAt: null }))).toBeNull();
    expect(quoteDataTime(undefined)).toBeNull();
  });
});

function connection(patch: Partial<ConnectionInfo>): ConnectionInfo {
  return { ...INITIAL_CONNECTION, ...patch };
}

describe('connectionNotice', () => {
  it('shows nothing while connected', () => {
    expect(connectionNotice(connection({ state: 'connected', lastMessageAt: 1 }))).toBeNull();
  });

  it('shows nothing during the first connect, before any price could be stale', () => {
    expect(connectionNotice(INITIAL_CONNECTION)).toBeNull();
    expect(connectionNotice(connection({ state: 'connecting' }))).toBeNull();
  });

  it('warns that prices may be stale while reconnecting, with the reason and retry time', () => {
    const notice = connectionNotice(
      connection({ state: 'reconnecting', reconnectAttempt: 2, nextRetryAt: 5_000, error: 'Simulated outage.' }),
    );
    expect(notice?.title).toMatch(/lost\. Prices may be stale/);
    expect(notice?.detail).toBe('Simulated outage.');
    expect(notice?.retryAt).toBe(5_000);
  });

  it('warns once the feed has gone away after working', () => {
    expect(connectionNotice(connection({ state: 'disconnected', lastMessageAt: 1 }))?.title).toMatch(
      /Disconnected .* Prices may be stale/,
    );
    expect(connectionNotice(connection({ state: 'connecting', lastMessageAt: 1 }))?.retryAt).toBeNull();
  });
});

describe('retryCountdown', () => {
  it('counts down in whole seconds, then reads "now" in the last second', () => {
    expect(retryCountdown(5_000, 1_000)).toBe('Retrying in 4s');
    expect(retryCountdown(5_000, 300)).toBe('Retrying in 4s');
    expect(retryCountdown(5_000, 3_500)).toBe('Retrying in 1s');
    expect(retryCountdown(5_000, 4_500)).toBe('Retrying now');
    expect(retryCountdown(5_000, 6_000)).toBe('Retrying now');
  });
});
