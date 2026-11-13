import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveRange } from '../../domain/chartRanges';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import { CHART_RANGES, type Bar, type ChartRange, type CreateAlertInput } from '../../domain/types';
import { isApiError, type ApiError, type ApiErrorCode } from '../api';
import type { SimulationState } from '../simulation';
import { RETENTION_FLOOR_MS } from './history';
import { createMockMarket } from './market';
import { createMockApi, DEFAULT_SEARCH_LIMIT, HISTORY_DELAY_MS, MAX_SEARCH_LIMIT } from './mockApi';
import { createRepository } from './repository';
import { SEED_WATCHLIST_SYMBOLS } from './seed';
import { createSimulationSource } from './simulationSource';

/** Wednesday 2026-10-21 15:00 UTC = 11:00 New York (EDT). */
const NOW = Date.UTC(2026, 9, 21, 15, 0);

function setup(sim: Partial<SimulationState> = {}, nowMs: number | (() => number) = NOW) {
  const now = typeof nowMs === 'number' ? () => nowMs : nowMs;
  const repo = createRepository({ now });
  const market = createMockMarket();
  const simulation = createSimulationSource({ apiLatencyMs: 0, ...sim });
  let counter = 0;
  const api = createMockApi({
    repo,
    market,
    simulation,
    now,
    createId: (prefix) => `${prefix}-${++counter}`,
  });
  return { repo, market, simulation, api };
}

async function apiError(promise: Promise<unknown>, code: ApiErrorCode, status?: number): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!isApiError(error)) throw new Error(`Expected ApiError ${code}, got ${String(error)}`);
  expect(error.code).toBe(code);
  if (status !== undefined) expect(error.status).toBe(status);
  return error;
}

const validAlert: CreateAlertInput = { symbol: 'aapl', condition: 'above', targetPrice: 250, tag: 'sell' };

afterEach(() => {
  vi.useRealTimers();
});

/** As many distinct valid symbols as a watchlist holds, none of them in the seed. */
function fullList(): string[] {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from(
    { length: MAX_WATCHLIST_SYMBOLS },
    (_, i) => `Q${letters[Math.floor(i / 26)]}${letters[i % 26]}`,
  );
}

describe('watchlist', () => {
  it('returns the seeded watchlist', async () => {
    const { api } = setup();
    expect(await api.getWatchlist()).toEqual({
      symbols: [...SEED_WATCHLIST_SYMBOLS],
      updatedAt: new Date(NOW).toISOString(),
    });
  });

  it('adds a normalized symbol at the end, including symbols outside the simulated universe', async () => {
    const { api, repo } = setup();
    repo.saveWatchlist({ ...repo.getWatchlist(), symbols: [] });
    const updated = await api.addSymbol(' brk.b ');
    expect(updated.symbols).toEqual(['BRK.B']);
    expect((await api.addSymbol('zzzz')).symbols).toEqual(['BRK.B', 'ZZZZ']);
    expect(repo.getWatchlist().symbols).toEqual(['BRK.B', 'ZZZZ']);
  });

  it('rejects bad symbols, duplicates and a full list', async () => {
    const { api, repo } = setup();
    const bad = await apiError(api.addSymbol('TOOLONG'), 'VALIDATION_ERROR', 400);
    expect(bad.details[0]?.field).toBe('symbol');
    await apiError(api.addSymbol(''), 'VALIDATION_ERROR', 400);
    await apiError(api.addSymbol('ÄPL'), 'VALIDATION_ERROR', 400);
    const dup = await apiError(api.addSymbol('aapl'), 'CONFLICT', 409);
    expect(dup.details[0]?.field).toBe('symbol');

    const many = fullList();
    repo.saveWatchlist({ ...repo.getWatchlist(), symbols: many });
    const full = await apiError(api.addSymbol('AAPL'), 'VALIDATION_ERROR', 400);
    expect(full.details[0]?.field).toBe('symbol');
    // A duplicate in a full list reports the duplicate.
    await apiError(api.addSymbol(many[0]!), 'CONFLICT', 409);
  });

  it('removes a symbol (normalizing input) and rejects symbols not in the list', async () => {
    const { api, repo } = setup();
    const updated = await api.removeSymbol(' nvda');
    expect(updated.symbols).toEqual(SEED_WATCHLIST_SYMBOLS.filter((s) => s !== 'NVDA'));
    expect(repo.getWatchlist()).toEqual(updated);
    await apiError(api.removeSymbol('NVDA'), 'NOT_FOUND', 404);
    await apiError(api.removeSymbol(''), 'NOT_FOUND', 404);
  });

  it('can be emptied and filled again', async () => {
    const { api } = setup();
    for (const symbol of SEED_WATCHLIST_SYMBOLS) await api.removeSymbol(symbol);
    expect((await api.getWatchlist()).symbols).toEqual([]);
    expect((await api.addSymbol('SPY')).symbols).toEqual(['SPY']);
  });

  describe('reorderSymbols', () => {
    const current = [...SEED_WATCHLIST_SYMBOLS];

    it('accepts an exact permutation (normalizing case)', async () => {
      const { api } = setup();
      const reversed = [...current].reverse();
      const updated = await api.reorderSymbols(reversed.map((s) => s.toLowerCase()));
      expect(updated.symbols).toEqual(reversed);
      expect((await api.getWatchlist()).symbols).toEqual(reversed);
    });

    it('accepts the identical order', async () => {
      const { api } = setup();
      await expect(api.reorderSymbols(current)).resolves.toMatchObject({ symbols: current });
    });

    it.each([
      ['a missing symbol', current.slice(1), 'symbols'],
      ['an extra symbol', [...current, 'SPY'], 'symbols.10'],
      ['a duplicate replacing one', [...current.slice(0, 9), 'AAPL'], 'symbols.9'],
      ['a foreign symbol replacing one', [...current.slice(0, 9), 'SPY'], 'symbols.9'],
      ['an empty list', [], 'symbols'],
      ['a non-string entry', [...current.slice(0, 9), 7], 'symbols.9'],
    ])('rejects %s with VALIDATION_ERROR', async (_label, symbols, field) => {
      const { api, repo } = setup();
      const before = repo.getWatchlist();
      const error = await apiError(api.reorderSymbols(symbols as string[]), 'VALIDATION_ERROR', 400);
      expect(error.details.map((d) => d.field)).toContain(field);
      expect(repo.getWatchlist()).toEqual(before);
    });

    it('rejects a non-array', async () => {
      const { api } = setup();
      await apiError(api.reorderSymbols('AAPL' as unknown as string[]), 'VALIDATION_ERROR', 400);
    });

    it('accepts an empty permutation of an empty list', async () => {
      const { api, repo } = setup();
      repo.saveWatchlist({ ...repo.getWatchlist(), symbols: [] });
      await expect(api.reorderSymbols([])).resolves.toMatchObject({ symbols: [] });
    });
  });

  it('changes updatedAt on every successful mutation', async () => {
    const { api } = setup();
    const steps = [
      () => api.addSymbol('SPY'),
      () => api.addSymbol('QQQ'),
      () => api.reorderSymbols(['QQQ', 'SPY', ...SEED_WATCHLIST_SYMBOLS]),
      () => api.removeSymbol('SPY'),
    ];
    let previous = await api.getWatchlist();
    for (const step of steps) {
      const next = await step();
      expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(previous.updatedAt));
      previous = next;
    }
  });

  it('leaves the watchlist and updatedAt unchanged when a mutation fails', async () => {
    const { api, repo } = setup();
    const before = repo.getWatchlist();
    await apiError(api.addSymbol('AAPL'), 'CONFLICT');
    await apiError(api.removeSymbol('SPY'), 'NOT_FOUND');
    await apiError(api.reorderSymbols(['AAPL']), 'VALIDATION_ERROR');
    expect(repo.getWatchlist()).toEqual(before);
  });
});

describe('alerts', () => {
  it('creates an armed alert with defaults and a normalized symbol', async () => {
    const { api, repo } = setup();
    const created = await api.createAlert({ ...validAlert, note: '  take profit  ' });
    expect(created).toMatchObject({
      symbol: 'AAPL',
      condition: 'above',
      targetPrice: 250,
      tag: 'sell',
      field: 'last',
      enabled: true,
      armed: true,
      note: 'take profit',
      lastTriggeredAt: null,
      lastTriggeredPrice: null,
      triggerCount: 0,
    });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(repo.getAlert(created.id)).toEqual(created);
  });

  it('honors enabled: false and turns a blank note into null', async () => {
    const { api } = setup();
    const created = await api.createAlert({ ...validAlert, enabled: false, note: '   ' });
    expect(created.enabled).toBe(false);
    expect(created.armed).toBe(true);
    expect(created.note).toBeNull();
  });

  it.each([
    ['zero target', { targetPrice: 0 }, 'targetPrice'],
    ['negative target', { targetPrice: -1 }, 'targetPrice'],
    ['NaN target', { targetPrice: Number.NaN }, 'targetPrice'],
    ['infinite target', { targetPrice: Number.POSITIVE_INFINITY }, 'targetPrice'],
    ['string target', { targetPrice: '10' }, 'targetPrice'],
    ['absurd target', { targetPrice: 5_000_000 }, 'targetPrice'],
    ['bad condition', { condition: 'equals' }, 'condition'],
    ['bad tag', { tag: 'hold' }, 'tag'],
    ['bad symbol', { symbol: 'BAD SYMBOL' }, 'symbol'],
    ['missing symbol', { symbol: undefined }, 'symbol'],
    ['non-boolean enabled', { enabled: 'yes' }, 'enabled'],
    ['non-string note', { note: 12 }, 'note'],
    ['overlong note', { note: 'n'.repeat(501) }, 'note'],
  ])('rejects %s with VALIDATION_ERROR on %s', async (_label, patch, field) => {
    const { api, repo } = setup();
    const before = repo.listAlerts().length;
    const error = await apiError(
      api.createAlert({ ...validAlert, ...patch } as unknown as CreateAlertInput),
      'VALIDATION_ERROR',
      400,
    );
    expect(error.details.map((d) => d.field)).toContain(field);
    expect(repo.listAlerts()).toHaveLength(before);
  });

  it('reports every invalid field at once', async () => {
    const { api } = setup();
    const error = await apiError(api.createAlert({} as CreateAlertInput), 'VALIDATION_ERROR');
    expect(error.details.map((d) => d.field).sort()).toEqual(['condition', 'symbol', 'tag', 'targetPrice']);
  });

  describe('updateAlert re-arming', () => {
    async function disarmed() {
      const ctx = setup();
      const created = await ctx.api.createAlert(validAlert);
      ctx.repo.saveAlert({ ...created, armed: false, triggerCount: 1 });
      return { ...ctx, id: created.id, created };
    }

    it('re-arms when the target price changes', async () => {
      const { api, id } = await disarmed();
      expect((await api.updateAlert(id, { targetPrice: 260 })).armed).toBe(true);
    });

    it('re-arms when the condition changes', async () => {
      const { api, id } = await disarmed();
      expect((await api.updateAlert(id, { condition: 'below' })).armed).toBe(true);
    });

    it('does not re-arm for the same target, the same condition, a tag change or a note change', async () => {
      const { api, id } = await disarmed();
      const updated = await api.updateAlert(id, {
        targetPrice: 250,
        condition: 'above',
        tag: 'buy',
        note: 'n',
      });
      expect(updated).toMatchObject({ armed: false, tag: 'buy', note: 'n', triggerCount: 1 });
    });

    it('re-arms when a disabled alert is enabled, but not when an enabled one is "enabled" again', async () => {
      const { api, repo, id } = await disarmed();
      expect((await api.updateAlert(id, { enabled: true })).armed).toBe(false);
      const disabled = await api.updateAlert(id, { enabled: false });
      expect(disabled).toMatchObject({ enabled: false, armed: false });
      repo.saveAlert({ ...repo.getAlert(id)!, armed: false });
      expect(await api.updateAlert(id, { enabled: true })).toMatchObject({ enabled: true, armed: true });
    });

    it('clears the note with null, keeps it when omitted, and ignores attempts to change the symbol', async () => {
      const { api, id } = await disarmed();
      await api.updateAlert(id, { note: 'keep me' });
      expect((await api.updateAlert(id, { tag: 'buy' })).note).toBe('keep me');
      expect((await api.updateAlert(id, { note: null })).note).toBeNull();
      const sneaky = await api.updateAlert(id, { symbol: 'MSFT' } as never);
      expect(sneaky.symbol).toBe('AAPL');
    });

    it('validates provided fields and leaves the alert unchanged on failure', async () => {
      const { api, repo, id } = await disarmed();
      const before = repo.getAlert(id);
      await apiError(api.updateAlert(id, { targetPrice: 0 }), 'VALIDATION_ERROR', 400);
      await apiError(api.updateAlert(id, { targetPrice: Number.NaN }), 'VALIDATION_ERROR', 400);
      await apiError(api.updateAlert(id, { condition: 'x' as never }), 'VALIDATION_ERROR', 400);
      await apiError(api.updateAlert(id, { enabled: 1 as never }), 'VALIDATION_ERROR', 400);
      expect(repo.getAlert(id)).toEqual(before);
      await apiError(api.updateAlert('missing', { targetPrice: 1 }), 'NOT_FOUND', 404);
    });

    it('changes updatedAt on every update (even a no-op one) and never createdAt', async () => {
      const { api, id, created } = await disarmed();
      let previous = created.updatedAt;
      for (const patch of [{ tag: 'buy' as const }, {}, { targetPrice: 1 }, { enabled: false }]) {
        const next = await api.updateAlert(id, patch);
        expect(next.createdAt).toBe(created.createdAt);
        expect(Date.parse(next.updatedAt)).toBeGreaterThan(Date.parse(previous));
        previous = next.updatedAt;
      }
    });
  });

  it('deletes and reports NOT_FOUND afterwards', async () => {
    const { api } = setup();
    await api.deleteAlert('alert-seed-msft');
    expect((await api.listAlerts()).map((a) => a.id)).not.toContain('alert-seed-msft');
    await apiError(api.deleteAlert('alert-seed-msft'), 'NOT_FOUND', 404);
  });
});

describe('search and instruments', () => {
  it('returns [] for an empty or blank query', async () => {
    const { api } = setup();
    expect(await api.searchInstruments('')).toEqual([]);
    expect(await api.searchInstruments('   ')).toEqual([]);
  });

  it('puts the exact symbol first, then other prefix matches, then name matches', async () => {
    const { api } = setup();
    const results = (await api.searchInstruments('ma')).map((i) => i.symbol);
    expect(results[0]).toBe('MA');
    // Name matches ("Walmart", "Mastercard"...) come after every symbol-prefix match.
    const firstNameOnly = results.findIndex((s) => !s.startsWith('MA'));
    expect(results.slice(firstNameOnly).every((s) => !s.startsWith('MA'))).toBe(true);
    expect(results).toContain('WMT');
  });

  it('is case-insensitive and matches company names by substring', async () => {
    const { api } = setup();
    expect((await api.searchInstruments('APPLE'))[0]?.symbol).toBe('AAPL');
    expect((await api.searchInstruments('berkshire')).map((i) => i.symbol)).toEqual(['BRK.B']);
    expect((await api.searchInstruments('brk.b'))[0]).toEqual({
      symbol: 'BRK.B',
      name: 'Berkshire Hathaway Inc. Class B',
      exchange: 'NYSE',
      assetClass: 'stock',
    });
    expect(await api.searchInstruments('qqqqqq')).toEqual([]);
  });

  it('never returns duplicates and respects the default and explicit limits', async () => {
    const { api } = setup();
    const defaults = await api.searchInstruments('a');
    expect(defaults).toHaveLength(DEFAULT_SEARCH_LIMIT);
    expect(new Set(defaults.map((i) => i.symbol)).size).toBe(defaults.length);
    expect(await api.searchInstruments('a', 3)).toHaveLength(3);
    expect(await api.searchInstruments('a', 1)).toHaveLength(1);
    expect((await api.searchInstruments('e', 1000)).length).toBeLessThanOrEqual(MAX_SEARCH_LIMIT);
  });

  it.each([0, -1, 2.5, Number.NaN])('rejects limit %s', async (limit) => {
    const { api } = setup();
    const error = await apiError(api.searchInstruments('a', limit), 'VALIDATION_ERROR', 400);
    expect(error.details[0]?.field).toBe('limit');
  });

  it('gets an instrument, returns null for unknown symbols, and validates format', async () => {
    const { api } = setup();
    expect(await api.getInstrument(' msft ')).toEqual({
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      exchange: 'NASDAQ',
      assetClass: 'stock',
    });
    expect(await api.getInstrument('ZZZZ')).toBeNull();
    await apiError(api.getInstrument('not valid'), 'VALIDATION_ERROR', 400);
  });
});

describe('simulation controls', () => {
  it('applies apiLatencyMs to CRUD and search calls', async () => {
    vi.useFakeTimers();
    const { api } = setup({ apiLatencyMs: 350 });
    let settled = false;
    const promise = api.getWatchlist().then((v) => {
      settled = true;
      return v;
    });
    await vi.advanceTimersByTimeAsync(349);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(promise).resolves.toMatchObject({ symbols: SEED_WATCHLIST_SYMBOLS });

    let searched = false;
    void api.searchInstruments('a').then(() => (searched = true));
    await vi.advanceTimersByTimeAsync(349);
    expect(searched).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(searched).toBe(true);
  });

  it('applies the mutation only after the latency', async () => {
    vi.useFakeTimers();
    const { api, repo } = setup({ apiLatencyMs: 1000 });
    const promise = api.removeSymbol('NFLX');
    await vi.advanceTimersByTimeAsync(500);
    expect(repo.getWatchlist().symbols).toContain('NFLX');
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(repo.getWatchlist().symbols).not.toContain('NFLX');
  });

  it('fails exactly the next call with UNAVAILABLE, resets the flag, and does not apply the mutation', async () => {
    const { api, simulation, repo } = setup({ failNextApiCall: true });
    await apiError(api.addSymbol('SPY'), 'UNAVAILABLE', 503);
    expect(simulation.get().failNextApiCall).toBe(false);
    expect(repo.getWatchlist().symbols).not.toContain('SPY');
    expect((await api.addSymbol('SPY')).symbols).toContain('SPY');
  });

  it('fails only one of two concurrent calls', async () => {
    const { api } = setup({ failNextApiCall: true });
    const results = await Promise.allSettled([api.listAlerts(), api.listAlerts()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('applies failNextApiCall to search, getInstrument and history too', async () => {
    vi.useFakeTimers();
    const { api, simulation } = setup({ failNextApiCall: true });
    await apiError(api.searchInstruments('a'), 'UNAVAILABLE');
    simulation.patch({ failNextApiCall: true });
    await apiError(api.getInstrument('AAPL'), 'UNAVAILABLE');
    simulation.patch({ failNextApiCall: true });
    const history = apiError(api.getHistory('AAPL', '1M'), 'UNAVAILABLE', 503);
    await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal);
    await history;
    expect(simulation.get().failNextApiCall).toBe(false);
  });
});

// ---- history ------------------------------------------------------------------------------------

const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Independent check via ICU: weekday and minutes after midnight in New York. */
function newYorkClock(epochSeconds: number): { weekday: string; minutes: number } {
  const parts = NY_PARTS.formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function newYorkDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function history(
  api: ReturnType<typeof setup>['api'],
  symbol: string,
  range: ChartRange,
  delay = HISTORY_DELAY_MS.normal,
) {
  const promise = api.getHistory(symbol, range);
  await vi.advanceTimersByTimeAsync(delay);
  return promise;
}

function expectWellFormed(bars: Bar[], lastPrice: number): void {
  expect(bars.length).toBeGreaterThan(0);
  expect(bars.length).toBeLessThan(1000);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    expect(Number.isInteger(b.time)).toBe(true);
    if (i > 0) expect(b.time).toBeGreaterThan(bars[i - 1]!.time);
    expect(b.low).toBeGreaterThan(0);
    expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
    expect(Number.isInteger(b.volume)).toBe(true);
    expect(b.volume).toBeGreaterThanOrEqual(0);
  }
  expect(bars.at(-1)?.close).toBe(lastPrice);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const SESSION_OPEN = 9 * 60 + 30;
const SESSION_CLOSE = 16 * 60;

describe('getHistory', () => {
  it.each([
    ['a Wednesday mid-session (EDT)', NOW],
    ['a Saturday', Date.UTC(2026, 9, 24, 18, 0)],
    ['a Monday before the open', Date.UTC(2026, 9, 26, 12, 0)],
    ['a winter evening (EST)', Date.UTC(2026, 0, 14, 23, 0)],
    ['the DST switch week', Date.UTC(2026, 2, 10, 16, 0)],
    ['a leap day', Date.UTC(2024, 1, 29, 20, 0)],
    ['New Year', Date.UTC(2027, 0, 1, 15, 0)],
  ])('returns well-formed, bounded bars for every range on %s', async (_label, nowMs) => {
    vi.useFakeTimers();
    const { api, market } = setup({}, nowMs);
    const last = market.getState('AAPL')!.last;
    for (const range of CHART_RANGES) {
      const result = await history(api, 'AAPL', range);
      expect(result).toMatchObject({ symbol: 'AAPL', range, simulated: true });
      expect(result.timeframe).toBe(resolveRange(range, new Date(nowMs)).timeframe);
      expectWellFormed(result.bars, last);
    }
  });

  it('keeps only the latest session for 1D, with bars inside 09:30-16:00 New York', async () => {
    vi.useFakeTimers();
    const { api } = setup({}, NOW);
    const { bars } = await history(api, 'MSFT', '1D');
    expect(new Set(bars.map((b) => newYorkDay(b.time)))).toEqual(new Set(['2026-10-21']));
    // 09:30 through 11:00 inclusive at 11:00 New York.
    expect(bars).toHaveLength(19);
    expect(newYorkClock(bars[0]!.time).minutes).toBe(SESSION_OPEN);
    expect(bars[1]!.time - bars[0]!.time).toBe(300);
  });

  it('shows the full previous session for 1D on a weekend (78 five-minute bars)', async () => {
    vi.useFakeTimers();
    const { api } = setup({}, Date.UTC(2026, 9, 25, 3, 0));
    const { bars } = await history(api, 'MSFT', '1D');
    expect(bars).toHaveLength(78);
    expect(new Set(bars.map((b) => newYorkDay(b.time)))).toEqual(new Set(['2026-10-23']));
    expect(newYorkClock(bars[0]!.time).minutes).toBe(SESSION_OPEN);
    expect(newYorkClock(bars.at(-1)!.time).minutes).toBe(SESSION_CLOSE - 5);
  });

  it.each([
    ['1W', 30, 13],
    ['1M', 60, 7],
  ] as const)(
    'puts %s bars only on weekdays inside the session (%i-minute bars, %i per day)',
    async (range, step, perDay) => {
      vi.useFakeTimers();
      // A Saturday, so every session in the window is complete; window spans the November DST change.
      const { api } = setup({}, Date.UTC(2026, 10, 7, 12, 0));
      const { bars } = await history(api, 'SPY', range);
      const perSession = new Map<string, number>();
      for (const bar of bars) {
        const clock = newYorkClock(bar.time);
        expect(WEEKDAYS).toContain(clock.weekday);
        expect(clock.minutes).toBeGreaterThanOrEqual(SESSION_OPEN);
        expect(clock.minutes).toBeLessThan(SESSION_CLOSE);
        expect((clock.minutes - SESSION_OPEN) % step).toBe(0);
        const day = newYorkDay(bar.time);
        perSession.set(day, (perSession.get(day) ?? 0) + 1);
      }
      for (const count of perSession.values()) expect(count).toBe(perDay);
      // 1W: Nov 2-6. 1M: Wed Oct 7 (opens after the 08:00 window start) through Fri Nov 6 = 23 weekdays.
      expect(perSession.size).toBe(range === '1W' ? 5 : 23);
    },
  );

  it('labels daily bars on weekdays at 00:00 UTC, weekly bars on Mondays, monthly bars on the 1st', async () => {
    vi.useFakeTimers();
    const { api } = setup({}, NOW);
    for (const range of ['3M', '6M', 'YTD', '1Y'] as const) {
      const { bars } = await history(api, 'KO', range);
      for (const bar of bars) {
        const d = new Date(bar.time * 1000);
        expect(d.getUTCHours() + d.getUTCMinutes()).toBe(0);
        expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
      }
    }
    const weekly = (await history(api, 'KO', '5Y')).bars;
    expect(weekly.every((b) => new Date(b.time * 1000).getUTCDay() === 1)).toBe(true);
    expect(weekly.length).toBeGreaterThan(255);
    for (const range of ['10Y', 'ALL'] as const) {
      const { bars } = await history(api, 'KO', range);
      expect(bars.every((b) => new Date(b.time * 1000).getUTCDate() === 1)).toBe(true);
    }
  });

  it('includes today as a daily bar only once the session has opened', async () => {
    vi.useFakeTimers();
    const before = setup({}, Date.UTC(2026, 9, 21, 13, 0));
    const after = setup({}, Date.UTC(2026, 9, 21, 13, 30));
    const today = Date.UTC(2026, 9, 21) / 1000;
    expect((await history(before.api, 'KO', '3M')).bars.at(-1)?.time).toBeLessThan(today);
    expect((await history(after.api, 'KO', '3M')).bars.at(-1)?.time).toBe(today);
  });

  it('starts YTD on the first weekday of the year', async () => {
    vi.useFakeTimers();
    const { api } = setup({}, NOW);
    const { bars } = await history(api, 'KO', 'YTD');
    expect(bars[0]?.time).toBe(Date.UTC(2026, 0, 1) / 1000);
    expect(bars.length).toBeGreaterThan(200);
    expect(bars.length).toBeLessThanOrEqual(262);
  });

  describe('truncation', () => {
    it.each([
      ['AAPL', '10Y', false],
      ['AAPL', '5Y', false],
      ['AAPL', 'ALL', true],
      ['PLTR', '10Y', true],
      ['PLTR', '5Y', false],
      ['PLTR', 'ALL', false],
      ['COIN', '5Y', false],
      ['ABNB', '10Y', true],
      ['UBER', '1Y', false],
    ] as const)('%s %s → truncated=%s', async (symbol, range, truncated) => {
      vi.useFakeTimers();
      const { api } = setup({}, NOW);
      expect((await history(api, symbol, range)).truncated).toBe(truncated);
    });

    it('never returns bars before the retention floor or the listing year', async () => {
      vi.useFakeTimers();
      const { api } = setup({}, NOW);
      const all = (await history(api, 'XOM', 'ALL')).bars;
      expect(all[0]?.time).toBe(RETENTION_FLOOR_MS / 1000);
      expect(all.length).toBeLessThan(140);
      const pltr = (await history(api, 'PLTR', '10Y')).bars;
      expect(pltr[0]?.time).toBe(Date.UTC(2020, 0, 1) / 1000);
    });

    it('marks a window that starts before the floor as truncated even for monthly bars', async () => {
      vi.useFakeTimers();
      // 10Y from 2025-06 starts 2015-06, before the 2016 floor.
      const { api } = setup({}, Date.UTC(2025, 5, 10, 15, 0));
      const result = await history(api, 'IBM', '10Y');
      expect(result.truncated).toBe(true);
      expect(result.bars[0]?.time).toBe(RETENTION_FLOOR_MS / 1000);
    });
  });

  it('is deterministic for the same symbol, range and time, and differs between symbols', async () => {
    vi.useFakeTimers();
    const a = setup({}, NOW);
    const b = setup({}, NOW);
    const first = await history(a.api, 'NVDA', '6M');
    const second = await history(b.api, 'NVDA', '6M');
    expect(first).toEqual(second);
    const other = await history(a.api, 'AMD', '6M');
    expect(other.bars.map((x) => x.close)).not.toEqual(first.bars.map((x) => x.close));
  });

  it('ends at the current simulated price after the market has moved', async () => {
    vi.useFakeTimers();
    const { api, market } = setup({}, NOW);
    for (let i = 0; i < 50; i++) market.trade('TSLA', NOW);
    const last = market.getState('TSLA')!.last;
    for (const range of ['1D', '1Y', 'ALL'] as const) {
      expect((await history(api, 'TSLA', range)).bars.at(-1)?.close).toBe(last);
    }
  });

  it('honors the history scenarios', async () => {
    vi.useFakeTimers();
    const { api, simulation } = setup({ historyScenario: 'slow' }, NOW);
    let done = false;
    const slow = api.getHistory('AAPL', '1M').then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.slow - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await slow).bars.length).toBeGreaterThan(0);

    simulation.patch({ historyScenario: 'normal' });
    let normalDone = false;
    void api.getHistory('AAPL', '1M').then(() => (normalDone = true));
    await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal - 1);
    expect(normalDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(normalDone).toBe(true);

    simulation.patch({ historyScenario: 'empty' });
    const empty = await history(api, 'AAPL', '1Y');
    expect(empty).toMatchObject({ bars: [], truncated: false, simulated: true, timeframe: '1Day' });

    simulation.patch({ historyScenario: 'error' });
    const failed = apiError(api.getHistory('AAPL', '1Y'), 'PROVIDER_ERROR', 502);
    await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal);
    await failed;
  });

  it('validates the symbol and range and reports unknown instruments as NOT_FOUND', async () => {
    vi.useFakeTimers();
    const { api } = setup({}, NOW);
    const checks = [
      apiError(api.getHistory('bad symbol', '1D'), 'VALIDATION_ERROR', 400),
      apiError(api.getHistory('AAPL', '2D' as ChartRange), 'VALIDATION_ERROR', 400),
      apiError(api.getHistory('ZZZZ', '1D'), 'NOT_FOUND', 404),
    ];
    await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal);
    await Promise.all(checks);
  });

  describe('abort', () => {
    it('rejects immediately with ABORTED for an already-aborted signal, without consuming failNextApiCall', async () => {
      vi.useFakeTimers();
      const { api, simulation } = setup({ failNextApiCall: true }, NOW);
      const controller = new AbortController();
      controller.abort();
      await apiError(api.getHistory('AAPL', '1D', controller.signal), 'ABORTED');
      expect(vi.getTimerCount()).toBe(0);
      expect(simulation.get().failNextApiCall).toBe(true);
    });

    it('rejects with ABORTED when aborted during the delay and clears its timer', async () => {
      vi.useFakeTimers();
      const { api } = setup({ historyScenario: 'slow' }, NOW);
      const controller = new AbortController();
      const pending = apiError(api.getHistory('AAPL', '1D', controller.signal), 'ABORTED');
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort();
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves normally when the signal is never aborted', async () => {
      vi.useFakeTimers();
      const { api } = setup({}, NOW);
      const controller = new AbortController();
      const promise = api.getHistory('AAPL', '1D', controller.signal);
      await vi.advanceTimersByTimeAsync(HISTORY_DELAY_MS.normal);
      expect((await promise).bars.length).toBeGreaterThan(0);
      // Aborting after completion is harmless.
      controller.abort();
    });
  });
});
