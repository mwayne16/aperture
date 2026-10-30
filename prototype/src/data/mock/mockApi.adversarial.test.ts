/** Adversarial checks of the mock HTTP API against the data-layer spec. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART_RANGES, type ChartRange } from '../../domain/types';
import { isApiError, type ApiError, type ApiErrorCode } from '../api';
import type { SimulationState } from '../simulation';
import { INSTRUMENTS } from './instruments';
import { createMockMarket } from './market';
import { createMockApi, HISTORY_DELAY_MS } from './mockApi';
import { createRepository } from './repository';
import { createSimulationSource } from './simulationSource';

const NOW = Date.UTC(2026, 9, 21, 15, 0);

function setup(sim: Partial<SimulationState> = {}, nowMs = NOW) {
  const now = () => nowMs; // frozen clock: updatedAt must still change on every mutation
  const repo = createRepository({ storage: null, now });
  const market = createMockMarket();
  const simulation = createSimulationSource({ apiLatencyMs: 0, ...sim });
  const api = createMockApi({ repo, market, simulation, now });
  return { repo, market, simulation, api };
}

async function settle<T>(promise: Promise<T>, ms = 0): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

async function expectError(
  promise: Promise<unknown>,
  code: ApiErrorCode,
  status: number,
  ms = 0,
): Promise<ApiError> {
  const outcome = promise.then(
    () => null,
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(ms);
  const error = await outcome;
  if (!isApiError(error)) throw new Error(`expected ApiError ${code}, got ${String(error)}`);
  expect(error.code).toBe(code);
  expect(error.status).toBe(status);
  return error;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('error envelope', () => {
  it('uses the documented codes and statuses for each failure class', async () => {
    const { api } = setup();
    const v = await expectError(api.createWatchlist({ name: '   ' }), 'VALIDATION_ERROR', 400);
    expect(v.details[0]?.field).toBe('name');
    await expectError(api.createWatchlist({ name: ' core TECH ' }), 'CONFLICT', 409);
    await expectError(api.renameWatchlist('nope', 'X'), 'NOT_FOUND', 404);
    await expectError(api.addSymbol('wl-core-tech', 'aapl'), 'CONFLICT', 409);
    const bad = await expectError(api.addSymbol('wl-core-tech', 'TOOLONG1'), 'VALIDATION_ERROR', 400);
    expect(bad.details).toEqual([expect.objectContaining({ field: 'symbol' })]);
    await expectError(api.removeSymbol('wl-ideas', 'AAPL'), 'NOT_FOUND', 404);
    await expectError(api.deleteAlert('nope'), 'NOT_FOUND', 404);
    await expectError(api.updateAlert('nope', { tag: 'buy' }), 'NOT_FOUND', 404);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects targetPrice %s on create and update with a targetPrice detail',
    async (targetPrice) => {
      const { api, repo } = setup();
      const e1 = await expectError(
        api.createAlert({ symbol: 'AAPL', condition: 'above', targetPrice, tag: 'buy' }),
        'VALIDATION_ERROR',
        400,
      );
      expect(e1.details.map((d) => d.field)).toContain('targetPrice');
      const before = repo.getAlert('alert-seed-aapl')!;
      const e2 = await expectError(api.updateAlert(before.id, { targetPrice }), 'VALIDATION_ERROR', 400);
      expect(e2.details.map((d) => d.field)).toContain('targetPrice');
      expect(repo.getAlert(before.id)).toEqual(before);
    },
  );
});

describe('alert mutations', () => {
  it('updatedAt strictly increases on every successful mutation even with a frozen clock; createdAt never changes', async () => {
    const { api } = setup();
    const created = await settle(
      api.createAlert({ symbol: 'msft', condition: 'below', targetPrice: 10, tag: 'buy' }),
    );
    let previous = created.updatedAt;
    const patches = [
      { tag: 'sell' as const },
      { note: 'x' },
      { enabled: false },
      { enabled: true },
      { targetPrice: 11 },
      {},
    ];
    for (const patch of patches) {
      const next = await settle(api.updateAlert(created.id, patch));
      expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(previous));
      expect(next.createdAt).toBe(created.createdAt);
      previous = next.updatedAt;
    }
  });

  it('re-arms on a target change, a condition change, or enabling; disabling leaves armed as it was', async () => {
    const { api, repo } = setup();
    const base = repo.getAlert('alert-seed-aapl')!;
    const disarm = (): void => {
      repo.saveAlert({ ...repo.getAlert(base.id)!, armed: false });
    };

    disarm();
    expect((await settle(api.updateAlert(base.id, { enabled: false }))).armed).toBe(false);
    expect((await settle(api.updateAlert(base.id, { enabled: true }))).armed).toBe(true);

    disarm();
    expect((await settle(api.updateAlert(base.id, { targetPrice: base.targetPrice + 1 }))).armed).toBe(true);

    disarm();
    expect((await settle(api.updateAlert(base.id, { condition: 'below' }))).armed).toBe(true);

    disarm();
    expect((await settle(api.updateAlert(base.id, { tag: 'buy', note: 'n' }))).armed).toBe(false);
  });
});

describe('reorderSymbols requires an exact permutation', () => {
  it.each([
    ['a missing symbol', (s: string[]) => s.slice(1)],
    ['an extra symbol', (s: string[]) => [...s, 'IBM']],
    ['a duplicate in place of another', (s: string[]) => [s[0]!, ...s.slice(0, -1)]],
    ['an empty list', () => []],
  ])('rejects %s with VALIDATION_ERROR and leaves the order unchanged', async (_label, mutate) => {
    const { api, repo } = setup();
    const before = repo.getWatchlist('wl-index-etfs')!;
    await expectError(api.reorderSymbols(before.id, mutate([...before.symbols])), 'VALIDATION_ERROR', 400);
    expect(repo.getWatchlist(before.id)).toEqual(before);
  });

  it('persists a valid permutation in the given order', async () => {
    const { api, repo } = setup();
    const before = repo.getWatchlist('wl-index-etfs')!;
    const reversed = [...before.symbols].reverse();
    const result = await settle(api.reorderSymbols(before.id, reversed));
    expect(result.symbols).toEqual(reversed);
    expect(repo.getWatchlist(before.id)!.symbols).toEqual(reversed);
  });
});

describe('failNextApiCall', () => {
  it('fails exactly one call with UNAVAILABLE, does not apply it, and resets', async () => {
    const { api, repo, simulation } = setup({ failNextApiCall: true, apiLatencyMs: 200 });
    await expectError(api.createWatchlist({ name: 'New' }), 'UNAVAILABLE', 503, 200);
    expect(simulation.get().failNextApiCall).toBe(false);
    expect(repo.listWatchlists().some((w) => w.name === 'New')).toBe(false);
    const created = await settle(api.createWatchlist({ name: 'New' }), 200);
    expect(created.name).toBe('New');
  });
});

describe('searchInstruments', () => {
  it('returns symbol-prefix matches (exact first) before any name-substring match', async () => {
    const { api } = setup();
    const results = await settle(api.searchInstruments('ms', 20));
    const symbols = results.map((r) => r.symbol);
    expect(symbols[0]).toBe('MS');
    const isPrefix = (s: string) => s.startsWith('MS');
    const firstName = symbols.findIndex((s) => !isPrefix(s));
    if (firstName !== -1) expect(symbols.slice(firstName).some(isPrefix)).toBe(false);
    for (const r of results) {
      expect(isPrefix(r.symbol) || r.name.toLowerCase().includes('ms')).toBe(true);
    }
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('defaults to 8 results, is case-insensitive and finds share classes', async () => {
    const { api } = setup();
    const a = await settle(api.searchInstruments('a'));
    expect(a).toHaveLength(8);
    expect(await settle(api.searchInstruments('A'))).toEqual(a);
    expect((await settle(api.searchInstruments('brk.b')))[0]?.symbol).toBe('BRK.B');
    expect((await settle(api.searchInstruments('BERKSHIRE')))[0]?.symbol).toBe('BRK.B');
    expect(await settle(api.searchInstruments(''))).toEqual([]);
    // Public shape only: no simulation parameters leak.
    expect(Object.keys(a[0]!).sort()).toEqual(['exchange', 'name', 'symbol']);
  });
});

describe('getHistory', () => {
  const nows = [
    NOW,
    Date.UTC(2026, 2, 9, 13, 45), // Monday after the March DST switch, 09:45 NY
    Date.UTC(2026, 10, 2, 14, 35), // Monday after the November DST switch, 09:35 NY
    Date.UTC(2026, 9, 25, 16, 0), // Sunday
    Date.UTC(2026, 0, 1, 12, 0), // New Year's Day
  ];

  it('keeps every range below 1000 bars for every instrument, with ascending unique times', async () => {
    for (const nowMs of nows) {
      const { api } = setup({}, nowMs);
      for (const profile of INSTRUMENTS) {
        for (const range of CHART_RANGES) {
          const result = await settle(api.getHistory(profile.symbol, range), HISTORY_DELAY_MS.normal);
          expect(result.bars.length).toBeLessThan(1000);
          expect(result.simulated).toBe(true);
          for (let i = 1; i < result.bars.length; i++) {
            expect(result.bars[i]!.time).toBeGreaterThan(result.bars[i - 1]!.time);
          }
          const floor = Math.max(Date.UTC(2016, 0, 1), Date.UTC(profile.listedYear, 0, 1)) / 1000;
          if (result.bars.length > 0 && range !== '1D' && range !== '1W' && range !== '1M') {
            expect(result.bars[0]!.time).toBeGreaterThanOrEqual(floor);
          }
        }
      }
    }
  }, 60_000);

  it('1D right after the open shows only today’s session', async () => {
    const { api } = setup({}, Date.UTC(2026, 2, 9, 13, 45));
    const { bars } = await settle(api.getHistory('AAPL', '1D'), HISTORY_DELAY_MS.normal);
    // 09:30, 09:35, 09:40, 09:45 New York (EDT, UTC-4) on Monday 2026-03-09.
    expect(bars.map((b) => b.time)).toEqual(
      [0, 5, 10, 15].map((m) => Date.UTC(2026, 2, 9, 13, 30 + m) / 1000),
    );
  });

  it('marks truncated when the window starts before the listing year and never otherwise for recent windows', async () => {
    const { api } = setup();
    const cases: [string, ChartRange, boolean][] = [
      ['COIN', '10Y', true],
      ['UBER', '10Y', true],
      ['AAPL', '1Y', false],
      ['AAPL', '1D', false],
      ['COIN', '1Y', false],
    ];
    for (const [symbol, range, truncated] of cases) {
      const result = await settle(api.getHistory(symbol, range), HISTORY_DELAY_MS.normal);
      expect([symbol, range, result.truncated]).toEqual([symbol, range, truncated]);
    }
  });

  it('rejects with ABORTED when aborted during the slow scenario and leaves no timer', async () => {
    const { api } = setup({ historyScenario: 'slow' });
    const controller = new AbortController();
    const promise = api.getHistory('AAPL', '1Y', controller.signal);
    const outcome = promise.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(2000);
    controller.abort();
    const error = await outcome;
    expect(isApiError(error) && error.code).toBe('ABORTED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('error scenario → PROVIDER_ERROR 502; empty scenario → zero bars', async () => {
    const { api, simulation } = setup({ historyScenario: 'error' });
    await expectError(api.getHistory('AAPL', '1M'), 'PROVIDER_ERROR', 502, HISTORY_DELAY_MS.normal);
    simulation.patch({ historyScenario: 'empty' });
    const empty = await settle(api.getHistory('AAPL', '1M'), HISTORY_DELAY_MS.normal);
    expect(empty).toMatchObject({ symbol: 'AAPL', range: '1M', bars: [], simulated: true });
  });
});
