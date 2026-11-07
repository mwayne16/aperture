import { describe, expect, it } from 'vitest';
import type { AlertEvent, PriceAlert } from '../../domain/types';
import { filterAlerts, filterEvents, summarizeAlerts } from './alertFilters';

function alert(id: string, symbol: string, patch: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol,
    condition: 'above',
    targetPrice: 100,
    tag: 'buy',
    field: 'last',
    enabled: true,
    armed: true,
    note: null,
    createdAt: '2026-10-30T12:00:00.000Z',
    updatedAt: '2026-10-30T12:00:00.000Z',
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
    ...patch,
  };
}

const alerts = [
  alert('armed', 'AAPL'),
  alert('waiting', 'MSFT', { armed: false }),
  alert('disabled', 'BTC/USD', { enabled: false }),
  alert('disabled-armed-false', 'AMD', { enabled: false, armed: false }),
];

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe('filterAlerts', () => {
  it('filters by status, treating a disabled alert as disabled whatever its armed flag', () => {
    expect(ids(filterAlerts(alerts, { status: 'all', query: '' }))).toEqual(ids(alerts));
    expect(ids(filterAlerts(alerts, { status: 'armed', query: '' }))).toEqual(['armed']);
    expect(ids(filterAlerts(alerts, { status: 'waiting', query: '' }))).toEqual(['waiting']);
    expect(ids(filterAlerts(alerts, { status: 'disabled', query: '' }))).toEqual(['disabled', 'disabled-armed-false']);
  });

  it('matches the symbol search anywhere in the symbol, ignoring case and spaces', () => {
    expect(ids(filterAlerts(alerts, { status: 'all', query: '  btc ' }))).toEqual(['disabled']);
    expect(ids(filterAlerts(alerts, { status: 'all', query: '/usd' }))).toEqual(['disabled']);
    expect(ids(filterAlerts(alerts, { status: 'all', query: 'a' }))).toEqual(['armed', 'disabled-armed-false']);
    expect(filterAlerts(alerts, { status: 'all', query: 'zzz' })).toEqual([]);
  });

  it('combines status and search', () => {
    expect(ids(filterAlerts(alerts, { status: 'disabled', query: 'amd' }))).toEqual(['disabled-armed-false']);
    expect(filterAlerts(alerts, { status: 'armed', query: 'msft' })).toEqual([]);
  });

  it('keeps listed ids past the status filter, but not past the search', () => {
    const keep = new Set(['waiting', 'disabled']);
    expect(ids(filterAlerts(alerts, { status: 'armed', query: '', keep }))).toEqual(['armed', 'waiting', 'disabled']);
    expect(ids(filterAlerts(alerts, { status: 'armed', query: 'ms', keep }))).toEqual(['waiting']);
  });
});

describe('filterEvents', () => {
  it('filters trigger events by symbol and keeps their order', () => {
    const event = (id: string, symbol: string) => ({ id, symbol }) as AlertEvent;
    const events = [event('e2', 'TSLA'), event('e1', 'AAPL')];
    expect(filterEvents(events, '')).toEqual(events);
    expect(ids(filterEvents(events, 'ts'))).toEqual(['e2']);
  });
});

describe('summarizeAlerts', () => {
  // 2026-10-30 23:30 ET (03:30 UTC on the 31st): still the 30th on the exchange clock.
  const lateEvening = Date.parse('2026-10-31T03:30:00.000Z');

  it('counts active, armed, waiting and disabled alerts', () => {
    expect(summarizeAlerts(alerts, lateEvening)).toEqual({
      active: 2,
      armed: 1,
      waiting: 1,
      disabled: 2,
      triggeredToday: 0,
    });
    expect(summarizeAlerts([], lateEvening)).toEqual({ active: 0, armed: 0, waiting: 0, disabled: 0, triggeredToday: 0 });
  });

  it('counts alerts whose last trigger fell on the current US Eastern day', () => {
    const list = [
      // 00:05 ET on the 30th: today.
      alert('morning', 'A', { lastTriggeredAt: '2026-10-30T04:05:00.000Z' }),
      // 23:59 ET on the 29th: yesterday, though it is the 30th in UTC.
      alert('yesterday', 'B', { lastTriggeredAt: '2026-10-30T03:59:00.000Z' }),
      // A disabled alert that fired today still counts.
      alert('disabled', 'C', { enabled: false, lastTriggeredAt: '2026-10-30T20:00:00.000Z' }),
      alert('garbage', 'D', { lastTriggeredAt: 'not a date' }),
    ];
    expect(summarizeAlerts(list, lateEvening).triggeredToday).toBe(2);
  });
});
