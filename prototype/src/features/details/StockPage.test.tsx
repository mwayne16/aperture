import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as LightweightCharts from 'lightweight-charts';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { routes } from '../../app/routes';
import { useUiStore } from '../../app/uiStore';
import { useToastStore } from '../../components/ui/toastStore';
import { ApiError } from '../../data/api';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import { MAX_WATCHLIST_SYMBOLS } from '../../domain/symbols';
import type { Bar, ChartRange, HistoryResult, PriceAlert, Quote, Watchlist } from '../../domain/types';
import { useAlertStore } from '../alerts/alertStore';
import { useSettingsStore } from '../settings/settingsStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { liveChart, mockCharts, seriesOf } from './chartMock';
import { resetChartView } from './chartView';
import { historyCache } from './historyCache';
import { StockPage } from './StockPage';
import { clearInstrumentCache } from './useInstrument';

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('./chartMock');
  return { ...actual, createChart: mock.createChart };
});

const DAY = 86_400;
const INITIAL_ALERTS = useAlertStore.getState();
const INITIAL_WATCHLISTS = useWatchlistStore.getState();

function renderPage(path: string, { strict = false } = {}) {
  const location = memoryLocation({ path, record: true });
  const page = (
    <Router hook={location.hook}>
      <Route path={routes.symbol} component={StockPage} />
    </Router>
  );
  const view = render(strict ? <StrictMode>{page}</StrictMode> : page);
  return { ...view, location };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL',
    last: 189.12,
    lastTradeAt: Date.now(),
    bid: 189.1,
    bidSize: 300,
    ask: 189.14,
    askSize: 200,
    quoteAt: Date.now(),
    open: 187.5,
    high: 190,
    low: 186.75,
    prevClose: 188,
    volume: 48_250_000,
    change: 1.12,
    changePct: 0.6,
    status: 'live',
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Daily bars for days that have all ended, oldest first. */
function pastDailyBars(values: { low: number; high: number; volume: number }[]): Bar[] {
  const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
  return values.map((value, i) => ({
    time: today - (values.length - i) * DAY,
    open: value.low,
    high: value.high,
    low: value.low,
    close: value.high,
    volume: value.volume,
  }));
}

function history(symbol: string, range: ChartRange, bars: Bar[]): HistoryResult {
  return { symbol, range, timeframe: range === '1D' ? '5Min' : '1Day', bars, truncated: false, simulated: true };
}

interface PendingHistory {
  symbol: string;
  range: ChartRange;
  resolve: (result: HistoryResult) => void;
}

/** Replaces api.getHistory with requests the test settles by hand. */
function controlHistory() {
  const requests: PendingHistory[] = [];
  const spy = vi.spyOn(api, 'getHistory').mockImplementation(
    (symbol, range) =>
      new Promise((resolve) => {
        requests.push({ symbol, range, resolve });
      }),
  );
  const settle = async (symbol: string, range: ChartRange, bars: Bar[]) => {
    const request = requests.find((r) => r.symbol === symbol && r.range === range);
    if (!request) throw new Error(`No request for ${symbol} ${range}.`);
    await act(async () => {
      request.resolve(history(symbol, range, bars));
      await Promise.resolve();
    });
  };
  return { requests, spy, settle };
}

function alert(id: string, overrides: Partial<PriceAlert> = {}): PriceAlert {
  return {
    id,
    symbol: 'AAPL',
    condition: 'above',
    targetPrice: 200,
    tag: 'buy',
    field: 'last',
    enabled: true,
    armed: true,
    note: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    lastTriggeredAt: null,
    lastTriggeredPrice: null,
    triggerCount: 0,
    ...overrides,
  };
}

function setAlerts(alerts: PriceAlert[], status: 'loading' | 'ready' | 'error' = 'ready', error: string | null = null) {
  act(() => {
    useAlertStore.setState({ alerts, confirmed: alerts, status, error });
  });
}

function setWatchlist(symbols: string[] | null) {
  const list: Watchlist[] =
    symbols === null ? [] : [{ id: 'wl', name: 'Core Tech', symbols, createdAt: '', updatedAt: '' }];
  act(() => {
    useWatchlistStore.setState({ status: 'ready', watchlists: list, activeId: symbols === null ? null : 'wl' });
  });
}

function card(name: string | RegExp) {
  return screen.getByRole('region', { name });
}

/** The page's own header, found from its h1. Inside the app's <main> it is not a banner landmark. */
function pageHeader(): HTMLElement {
  const header = screen.getByRole('heading', { level: 1 }).closest('header');
  if (!header) throw new Error('No page header.');
  return header;
}

/** Text in the page header; the company name also appears in the About card. */
function headerText(text: string) {
  return within(pageHeader()).findByText(text);
}

beforeEach(() => {
  updateSimulation({ apiLatencyMs: 0 });
  act(() => {
    useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, state: 'connected', simulated: true });
  });
  setAlerts([]);
  setWatchlist([]);
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ selectedSymbol: null, alertDialog: { open: false } });
    useQuoteStore.getState().clear();
    useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
    useSettingsStore.getState().reset();
    useAlertStore.setState(INITIAL_ALERTS, true);
    useWatchlistStore.setState(INITIAL_WATCHLISTS, true);
    useToastStore.setState({ toasts: [] });
    resetChartView();
  });
  resetSimulation();
  historyCache.clear();
  clearInstrumentCache();
  mockCharts.length = 0;
});

describe('StockPage header', () => {
  it('shows the symbol, company, exchange, asset class, Simulated marker and live price, and selects the symbol', async () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote()]);
    });
    renderPage('/symbol/aapl');
    expect(screen.getByRole('heading', { level: 1, name: 'AAPL' })).toBeInTheDocument();
    expect(useUiStore.getState().selectedSymbol).toBe('AAPL');
    expect(await headerText('Apple Inc.')).toBeInTheDocument();
    const header = pageHeader();
    expect(within(header).getByText('NASDAQ')).toBeInTheDocument();
    expect(within(header).getByText('Stock')).toBeInTheDocument();
    expect(within(header).getByText('Simulated')).toBeInTheDocument();
    expect(within(header).getByText('189.12')).toBeInTheDocument();
    expect(within(header).getByText('+1.12 (+0.60%)')).toHaveClass('is-gain');
    expect(within(header).getByText('Live')).toBeInTheDocument();
    expect(within(header).getByText(/ET · just now$/)).toBeInTheDocument();
  });

  it('labels a crypto pair and an ETF by their asset class and trading hours', async () => {
    const crypto = renderPage('/symbol/BTC%2FUSD');
    expect(screen.getByRole('heading', { level: 1, name: 'BTC/USD' })).toBeInTheDocument();
    expect(await headerText('Bitcoin')).toBeInTheDocument();
    expect(within(pageHeader()).getByText('Crypto')).toBeInTheDocument();
    expect(within(card('About')).getByText('24/7, every day')).toBeInTheDocument();
    crypto.unmount();

    renderPage('/symbol/SPY');
    expect(await headerText('SPDR S&P 500 ETF Trust')).toBeInTheDocument();
    expect(within(pageHeader()).getByText('ETF')).toBeInTheDocument();
    expect(within(card('About')).getByText('9:30–16:00 ET, Monday to Friday')).toBeInTheDocument();
  });

  it('explains an unknown symbol without actions, chart or history requests', async () => {
    const spy = vi.spyOn(api, 'getHistory');
    renderPage('/symbol/ZZZZ');
    expect(await screen.findByText('No instrument found for ZZZZ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create alert' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Chart range' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Browse stocks' })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a malformed symbol without asking the provider or changing the selection', () => {
    const spy = vi.spyOn(api, 'getInstrument');
    renderPage('/symbol/abc123');
    expect(screen.getByRole('heading', { level: 1, name: 'abc123' })).toBeInTheDocument();
    expect(screen.getByText('“abc123” isn\'t a valid symbol')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(useUiStore.getState().selectedSymbol).toBeNull();
  });

  it('waits for company details before loading the page body', () => {
    vi.spyOn(api, 'getInstrument').mockReturnValue(new Promise(() => undefined));
    const spy = vi.spyOn(api, 'getHistory');
    renderPage('/symbol/AAPL');
    expect(screen.getByText('Loading company details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create alert' })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the quote and chart when company details fail, and retries them', async () => {
    vi.spyOn(api, 'getInstrument').mockRejectedValueOnce(new ApiError('UNAVAILABLE', 'Service down', 503));
    renderPage('/symbol/AAPL');
    expect(await screen.findAllByText('Company details unavailable')).toHaveLength(2);
    expect(screen.getByRole('radiogroup', { name: 'Chart range' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create alert' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading company details' }));
    expect(await headerText('Apple Inc.')).toBeInTheDocument();
    expect(within(card('About')).getByText('NASDAQ')).toBeInTheDocument();
  });

  it('opens the alert dialog for the symbol from the header and the alerts card', async () => {
    renderPage('/symbol/MSFT');
    await userEvent.click(await screen.findByRole('button', { name: 'Create alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'MSFT' });
    act(() => {
      useUiStore.getState().closeAlertDialog();
    });
    await userEvent.click(within(card('Alerts for MSFT')).getByRole('button', { name: 'New alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'MSFT' });
  });

  it('pops the page out into its own window, and says so when the window is blocked', async () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValueOnce({ focus } as unknown as Window).mockReturnValueOnce(null);
    renderPage('/symbol/BTC%2FUSD');
    const button = await screen.findByRole('button', { name: 'Open BTC/USD in a new window' });
    await userEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/#\/symbol\/BTC%2FUSD$/),
      'aperture-symbol-BTC-2FUSD',
      expect.any(String),
    );
    expect(focus).toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);

    await userEvent.click(button);
    expect(useToastStore.getState().toasts[0]?.title).toBe('The new window was blocked');
  });
});

describe('StockPage watch toggle', () => {
  it('adds the symbol to the active list and names the list', async () => {
    const addSymbol = vi.fn(() => Promise.resolve());
    act(() => {
      useWatchlistStore.setState({ addSymbol });
    });
    setWatchlist(['MSFT']);
    renderPage('/symbol/AAPL');
    const button = await screen.findByRole('button', { name: 'Watch' });
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add AAPL to Core Tech');
    await userEvent.click(button);
    expect(addSymbol).toHaveBeenCalledWith('wl', 'AAPL');
  });

  it('removes a watched symbol', async () => {
    const removeSymbol = vi.fn(() => Promise.resolve());
    act(() => {
      useWatchlistStore.setState({ removeSymbol });
    });
    setWatchlist(['AAPL']);
    renderPage('/symbol/AAPL');
    await userEvent.click(await screen.findByRole('button', { name: 'Watching' }));
    expect(removeSymbol).toHaveBeenCalledWith('wl', 'AAPL');
  });

  it('reports a failed add', async () => {
    act(() => {
      useWatchlistStore.setState({ addSymbol: () => Promise.reject(new ApiError('UNAVAILABLE', 'Service down', 503)) });
    });
    setWatchlist([]);
    renderPage('/symbol/AAPL');
    await userEvent.click(await screen.findByRole('button', { name: 'Watch' }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        tone: 'error',
        title: "Couldn't add AAPL to Core Tech",
        description: 'Service down',
      });
    });
    expect(screen.getByRole('button', { name: 'Watch' })).not.toHaveAttribute('aria-busy');
  });

  it('stays focusable but inert without a list or with a full one, and explains why', async () => {
    const addSymbol = vi.fn(() => Promise.resolve());
    act(() => {
      useWatchlistStore.setState({ addSymbol });
    });
    setWatchlist(null);
    const view = renderPage('/symbol/AAPL');
    const button = await screen.findByRole('button', { name: 'Watch' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Create a watchlist to watch AAPL.');
    await userEvent.click(button);
    expect(addSymbol).not.toHaveBeenCalled();
    view.unmount();

    setWatchlist(Array.from({ length: MAX_WATCHLIST_SYMBOLS }, (_, i) => `X${i}`));
    renderPage('/symbol/AAPL');
    const full = await screen.findByRole('button', { name: 'Watch' });
    expect(full).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(full);
    expect(addSymbol).not.toHaveBeenCalled();
  });
});

describe('StockPage chart', () => {
  it('opens on the default range and style from the settings', async () => {
    act(() => {
      useSettingsStore.getState().update({ defaultChartRange: '1M', chartStyle: 'line' });
    });
    const { settle } = controlHistory();
    renderPage('/symbol/AAPL');
    expect(await screen.findByRole('radio', { name: '1M' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Line' })).toBeChecked();
    await settle('AAPL', '1M', pastDailyBars([{ low: 1, high: 2, volume: 5 }]));
    await waitFor(() => {
      expect(seriesOf(liveChart(), 'Line').data).toHaveLength(1);
    });
  });

  it('switches between candles and a line without loading the history again', async () => {
    const { spy, settle } = controlHistory();
    renderPage('/symbol/AAPL');
    await screen.findByRole('radiogroup', { name: 'Chart style' });
    await settle('AAPL', '1D', pastDailyBars([{ low: 1, high: 2, volume: 5 }, { low: 2, high: 3, volume: 5 }]));
    await waitFor(() => {
      expect(seriesOf(liveChart(), 'Candlestick').data).toHaveLength(2);
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Line' }));
    expect(seriesOf(liveChart(), 'Line').data).toEqual([
      expect.objectContaining({ value: 2 }),
      expect.objectContaining({ value: 3 }),
    ]);
    expect(mockCharts).toHaveLength(1);
    expect(spy.mock.calls.filter(([, range]) => range === '1D')).toHaveLength(1);
  });

  it('never shows the previous symbol once the address changes', async () => {
    const { settle } = controlHistory();
    const { location } = renderPage('/symbol/AAPL');
    await screen.findByRole('radiogroup', { name: 'Chart range' });
    act(() => {
      location.navigate('/symbol/MSFT');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'MSFT' })).toBeInTheDocument();
    expect(useUiStore.getState().selectedSymbol).toBe('MSFT');
    await headerText('Microsoft Corporation');
    await settle('AAPL', '1D', pastDailyBars([{ low: 1, high: 2, volume: 5 }]));
    expect(mockCharts.filter((c) => !c.removed)).toHaveLength(0);
    expect(screen.queryByText('Apple Inc.')).toBeNull();
  });

  it('requests company details, news and each history range once under StrictMode', async () => {
    const { spy } = controlHistory();
    const instrumentSpy = vi.spyOn(api, 'getInstrument');
    const newsSpy = vi.spyOn(api, 'getNews');
    renderPage('/symbol/AAPL', { strict: true });
    await headerText('Apple Inc.');
    await waitFor(() => {
      expect(newsSpy).toHaveBeenCalledTimes(1);
    });
    expect(instrumentSpy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls.map(([, range]) => range).sort()).toEqual(['1D', '1Y', '3M']);
  });
});

describe('StockPage statistics', () => {
  it('shows session values, the 3-month average volume and the 52-week range from history', async () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ last: 150, high: 151, low: 149 })]);
    });
    const { settle } = controlHistory();
    renderPage('/symbol/AAPL');
    const stats = await screen.findByRole('region', { name: 'Key statistics' });
    expect(within(stats).getByText('Bid').nextElementSibling).toHaveTextContent('189.10 × 300');
    expect(within(stats).getByText('Spread').nextElementSibling).toHaveTextContent(/^0\.04$/);
    expect(within(stats).getAllByText('Loading')).toHaveLength(2);

    await settle('AAPL', '3M', pastDailyBars([
      { low: 1, high: 2, volume: 1_000_000 },
      { low: 1, high: 2, volume: 3_000_000 },
    ]));
    expect(within(stats).getByText('Avg volume (3M)').nextElementSibling).toHaveTextContent('2.00M');

    await settle('AAPL', '1Y', pastDailyBars([
      { low: 100, high: 120, volume: 1 },
      { low: 110, high: 200, volume: 1 },
    ]));
    const range = within(stats).getByRole('img');
    expect(range).toHaveAccessibleName(
      'From 100.00 to 200.00. The current price, 150.00, is 50% of the way up.',
    );
    expect(within(stats).getByText('52-week range').nextElementSibling).toHaveTextContent('100.00200.00');
    expect(within(stats).getByText(/volume will count IEX trades only/)).toBeInTheDocument();
  });

  it('never shows fundamentals the provider does not have', async () => {
    renderPage('/symbol/AAPL');
    await screen.findByRole('region', { name: 'Key statistics' });
    for (const label of [/market cap/i, /P\/E/, /EPS/, /revenue/i, /margin/i, /dividend/i]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('offers a retry for statistics whose history failed', async () => {
    updateSimulation({ historyScenario: 'error' });
    renderPage('/symbol/AAPL');
    const stats = await screen.findByRole('region', { name: 'Key statistics' });
    expect(await within(stats).findAllByText('Unavailable')).toHaveLength(2);
    updateSimulation({ historyScenario: 'normal' });
    await userEvent.click(within(stats).getByRole('button', { name: 'Retry loading 3-month history' }));
    await userEvent.click(within(stats).getByRole('button', { name: 'Retry loading 1-year history' }));
    await waitFor(() => {
      expect(within(stats).queryByText('Unavailable')).toBeNull();
    });
    expect(await within(stats).findByRole('img')).toHaveAccessibleName(/^From /);
  });

  it('shows a dash rather than a made-up range when history is empty', async () => {
    updateSimulation({ historyScenario: 'empty' });
    act(() => {
      useQuoteStore.getState().applyBatch([quote()]);
    });
    renderPage('/symbol/AAPL');
    const stats = await screen.findByRole('region', { name: 'Key statistics' });
    await waitFor(() => {
      expect(within(stats).queryByText('Loading')).toBeNull();
    });
    expect(within(stats).getByText('52-week range').nextElementSibling).toHaveTextContent('—');
    expect(within(stats).getByText('Avg volume (3M)').nextElementSibling).toHaveTextContent('—');
    expect(within(stats).queryByRole('img')).toBeNull();
  });
});

describe('StockPage alerts card', () => {
  it("lists only this symbol's alerts with their condition and status", async () => {
    setAlerts([
      alert('a', { condition: 'below', targetPrice: 150, tag: 'sell' }),
      alert('b', { symbol: 'MSFT' }),
      alert('c', { targetPrice: 210, enabled: false }),
      alert('d', { targetPrice: 200, armed: false }),
    ]);
    renderPage('/symbol/AAPL');
    const alerts = await screen.findByRole('region', { name: 'Alerts for AAPL' });
    const rows = within(alerts).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.symbol-alert__condition')?.textContent)).toEqual([
      'Last ≥ 200.00',
      'Last ≥ 210.00',
      'Last ≤ 150.00',
    ]);
    expect(rows[0]).toHaveTextContent('Triggered, waiting to re-arm');
    expect(rows[1]).toHaveTextContent('Disabled');
    expect(rows[2]).toHaveTextContent('Armed');
    expect(rows[2]).toHaveTextContent('Sell');
    expect(within(alerts).getByText(/Aperture never places trades/)).toBeInTheDocument();
  });

  it('edits an alert in the dialog and toggles it with its switch', async () => {
    const setEnabled = vi.fn(() => Promise.resolve());
    act(() => {
      useAlertStore.setState({ setEnabled });
    });
    setAlerts([alert('a')]);
    renderPage('/symbol/AAPL');
    const alerts = await screen.findByRole('region', { name: 'Alerts for AAPL' });
    await userEvent.click(within(alerts).getByRole('button', { name: 'Edit alert Last ≥ 200.00' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'edit', alertId: 'a' });
    await userEvent.click(within(alerts).getByRole('switch', { name: 'Enabled: Last ≥ 200.00' }));
    expect(setEnabled).toHaveBeenCalledWith('a', false);
  });

  it('shows loading, empty and error states', async () => {
    setAlerts([], 'loading');
    const view = renderPage('/symbol/AAPL');
    expect(await screen.findByText('Loading alerts')).toBeInTheDocument();
    setAlerts([]);
    expect(screen.getByText('No alerts for AAPL')).toBeInTheDocument();
    view.unmount();

    const load = vi.fn(() => Promise.resolve());
    act(() => {
      useAlertStore.setState({ load });
    });
    setAlerts([], 'error', 'Service down');
    renderPage('/symbol/AAPL');
    const alerts = await screen.findByRole('region', { name: 'Alerts for AAPL' });
    expect(within(alerts).getByText("Couldn't load alerts")).toBeInTheDocument();
    await userEvent.click(within(alerts).getByRole('button', { name: 'Retry' }));
    expect(load).toHaveBeenCalledWith({ force: true });
  });
});

describe('StockPage news card', () => {
  it('lists simulated headlines for the symbol, marked Simulated and without links', async () => {
    const spy = vi.spyOn(api, 'getNews');
    renderPage('/symbol/AAPL');
    const news = await screen.findByRole('region', { name: 'News' });
    await waitFor(() => {
      expect(within(news).getAllByRole('listitem').length).toBeGreaterThan(0);
    });
    expect(spy).toHaveBeenCalledWith({ symbols: ['AAPL'], limit: 5 });
    expect(within(news).getAllByText('Simulated').length).toBeGreaterThan(1);
    expect(within(news).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent(/AAPL|Apple/);
    expect(within(news).queryByRole('link')).toBeNull();
  });

  it('offers a retry when news fails to load', async () => {
    vi.spyOn(api, 'getNews').mockRejectedValueOnce(new ApiError('UNAVAILABLE', 'News is down', 503));
    renderPage('/symbol/AAPL');
    const news = await screen.findByRole('region', { name: 'News' });
    expect(await within(news).findByText('News is down')).toBeInTheDocument();
    await userEvent.click(within(news).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(within(news).getAllByRole('listitem').length).toBeGreaterThan(0);
    });
  });
});
