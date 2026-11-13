import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as LightweightCharts from 'lightweight-charts';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { useUiStore } from '../../app/uiStore';
import { ApiError } from '../../data/api';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { useQuoteStore } from '../../data/quoteStore';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import type { ChartRange, ConnectionState, HistoryResult, Instrument, Quote } from '../../domain/types';
import { useSettingsStore } from '../settings/settingsStore';
import { liveChart, mockCharts, seriesOf } from './chartMock';
import { resetChartView } from './chartView';
import { historyCache } from './historyCache';
import { StockDetail } from './StockDetail';
import { clearInstrumentCache } from './useInstrument';

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal<typeof LightweightCharts>();
  const mock = await import('./chartMock');
  return { ...actual, createChart: mock.createChart };
});

const DAY = 86_400;
const START = Date.UTC(2026, 9, 19) / 1000;

function history(symbol: string, range: ChartRange, closes: number[], truncated = false): HistoryResult {
  return {
    symbol,
    range,
    timeframe: range === '1D' ? '5Min' : '1Day',
    bars: closes.map((close, i) => ({
      time: START + i * DAY,
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1_000_000,
    })),
    truncated,
    simulated: true,
  };
}

interface PendingHistory {
  symbol: string;
  range: ChartRange;
  signal: AbortSignal | undefined;
  resolve: (result: HistoryResult) => void;
  reject: (error: unknown) => void;
}

/** Replaces api.getHistory with requests the test settles by hand. */
function controlHistory() {
  const requests: PendingHistory[] = [];
  const spy = vi.spyOn(api, 'getHistory').mockImplementation(
    (symbol, range, signal) =>
      new Promise((resolve, reject) => {
        requests.push({ symbol, range, signal, resolve, reject });
      }),
  );
  const find = (symbol: string, range: ChartRange) => {
    const request = requests.find((r) => r.symbol === symbol && r.range === range);
    if (!request) throw new Error(`No request for ${symbol} ${range}.`);
    return request;
  };
  return { requests, spy, find };
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

function setConnection(state: ConnectionState) {
  act(() => {
    useConnectionStore.getState().setConnection({ ...INITIAL_CONNECTION, state });
  });
}

function select(symbol: string | null) {
  act(() => {
    useUiStore.getState().selectSymbol(symbol);
  });
}

const chartRegion = () => screen.getByRole('group', { name: /price history/ });

beforeEach(() => {
  updateSimulation({ apiLatencyMs: 0 });
  setConnection('connected');
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ selectedSymbol: null, alertDialog: { open: false } });
    useQuoteStore.getState().clear();
    useConnectionStore.getState().setConnection(INITIAL_CONNECTION);
    useSettingsStore.getState().reset();
    resetChartView();
  });
  resetSimulation();
  historyCache.clear();
  clearInstrumentCache();
  mockCharts.length = 0;
});

describe('StockDetail selection', () => {
  it('asks for a selection when nothing is selected', () => {
    render(<StockDetail />);
    expect(screen.getByText('Select a symbol to see its details')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('shows the symbol, company, exchange and a Simulated marker', async () => {
    select('aapl');
    render(<StockDetail />);
    expect(screen.getByRole('heading', { level: 2, name: 'AAPL' })).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    expect(screen.getByText('NASDAQ')).toBeInTheDocument();
  });

  it('opens the alert dialog for the selected symbol', async () => {
    select('MSFT');
    render(<StockDetail />);
    await userEvent.click(screen.getByRole('button', { name: 'Create alert' }));
    expect(useUiStore.getState().alertDialog).toEqual({ open: true, mode: 'create', presetSymbol: 'MSFT' });
  });

  it('explains an unknown symbol instead of showing empty data', async () => {
    select('ZZZZ');
    render(<StockDetail />);
    expect(await screen.findByText('No instrument found for ZZZZ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create alert' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Chart range' })).toBeNull();
  });

  it('offers a retry when company details fail to load', async () => {
    vi.spyOn(api, 'getInstrument').mockRejectedValueOnce(new ApiError('UNAVAILABLE', 'Service down', 503));
    select('AAPL');
    render(<StockDetail />);
    expect(await screen.findByText('Company details unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading company details' }));
    expect(document.activeElement).toHaveClass('details__identity');
    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
  });

  it('ignores company details that arrive after the selection moved on', async () => {
    let resolveSlow: (value: Instrument) => void = () => undefined;
    vi.spyOn(api, 'getInstrument').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        }),
    );
    select('AAPL');
    render(<StockDetail />);
    select('MSFT');
    expect(await screen.findByText('Microsoft Corporation')).toBeInTheDocument();
    await act(async () => {
      resolveSlow({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', assetClass: 'stock' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Apple Inc.')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'MSFT' })).toBeInTheDocument();
  });
});

describe('StockDetail quote', () => {
  it('shows the live quote with its change, status, age and stats', () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote()]);
    });
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('189.12')).toBeInTheDocument();
    const change = screen.getByText('+1.12 (+0.60%)');
    expect(change).toHaveClass('is-gain');
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/ET · just now$/)).toBeInTheDocument();
    const stats = screen.getByText('Bid').closest('dl');
    if (!stats) throw new Error('No stats grid.');
    expect(within(stats).getByText('Bid').nextElementSibling).toHaveTextContent('189.10 × 300');
    expect(within(stats).getByText('Ask').nextElementSibling).toHaveTextContent('189.14 × 200');
    expect(within(stats).getByText('Volume').nextElementSibling).toHaveTextContent('48.3M');
  });

  it('prints a small change and the spread with the decimals of the price', () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ last: 235.12, change: 0.76, changePct: 0.32, bid: 235.1, ask: 235.18 })]);
    });
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('+0.76 (+0.32%)')).toBeInTheDocument();
    const stats = screen.getByText('Spread').closest('dl');
    if (!stats) throw new Error('No stats grid.');
    expect(within(stats).getByText('Spread').nextElementSibling).toHaveTextContent(/^0\.08$/);
  });

  it('colors a falling price as a loss and greys out a stale one', () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ change: -2.5, changePct: -1.31, status: 'stale' })]);
    });
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('−2.50 (−1.31%)')).toHaveClass('is-loss');
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('189.12').closest('.details-quote__last')).toHaveClass('is-dimmed');
  });

  it('updates in place when a tick arrives', () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote()]);
    });
    select('AAPL');
    render(<StockDetail />);
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ last: 190.5, change: 2.5, changePct: 1.33 })]);
    });
    expect(screen.getByText('190.50')).toBeInTheDocument();
    expect(screen.getByText('+2.50 (+1.33%)')).toBeInTheDocument();
  });

  it('says when the feed is down and there is no quote yet', () => {
    setConnection('disconnected');
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('The feed is disconnected. No quote yet.')).toHaveAttribute('role', 'status');
    // ** No first quote can arrive while disconnected, so the price is a dash rather than a loading skeleton.
    expect(screen.getByText('—', { selector: '.details-quote__last' })).toHaveTextContent('Last price —');
  });

  it('keeps the last quote visible while reconnecting', () => {
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ status: 'stale' })]);
    });
    setConnection('reconnecting');
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('Reconnecting to the feed. Showing the last quote received.')).toBeInTheDocument();
    expect(screen.getByText('189.12')).toBeInTheDocument();
  });
});

describe('StockDetail chart', () => {
  it('loads the history for the selected range from the data layer', async () => {
    select('AAPL');
    render(<StockDetail />);
    expect(screen.getByText('Loading price history…')).toBeInTheDocument();
    expect(screen.getByText('5-minute bars')).toBeInTheDocument();
    await waitFor(() => {
      expect(chartRegion()).toBeInTheDocument();
    });
    expect(seriesOf(liveChart(), 'Candlestick').data.length).toBeGreaterThan(0);
    expect(screen.getByText(/5-minute bars · Simulated/)).toBeInTheDocument();
  });

  it('shows the bar size for each range and notes truncated history', async () => {
    select('AAPL');
    render(<StockDetail />);
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getByText('Monthly bars')).toBeInTheDocument();
    expect(await screen.findByText('History starts Jan 2016 (earliest available)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '1Y' }));
    expect(screen.getByText('Daily bars')).toBeInTheDocument();
    expect(screen.queryByText(/History starts/)).toBeNull();
  });

  it('shows an empty state when the provider returns no bars', async () => {
    updateSimulation({ historyScenario: 'empty' });
    select('AAPL');
    render(<StockDetail />);
    expect(await screen.findByText('No bars for this range')).toBeInTheDocument();
  });

  it('does not keep showing an empty range once the provider has bars again', async () => {
    updateSimulation({ historyScenario: 'empty' });
    select('AAPL');
    render(<StockDetail />);
    expect(await screen.findByText('No bars for this range')).toBeInTheDocument();
    updateSimulation({ historyScenario: 'normal' });
    await userEvent.click(screen.getByRole('radio', { name: '1W' }));
    await userEvent.click(screen.getByRole('radio', { name: '1D' }));
    await waitFor(() => {
      expect(chartRegion()).toBeInTheDocument();
    });
  });

  it('shows the error with a Retry that loads the history again', async () => {
    updateSimulation({ historyScenario: 'error' });
    select('AAPL');
    render(<StockDetail />);
    expect(await screen.findByText("Couldn't load price history")).toBeInTheDocument();
    expect(screen.getByText('The market data provider could not load history (simulated).')).toBeInTheDocument();

    updateSimulation({ historyScenario: 'normal' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Loading price history…')).toBeInTheDocument();
    expect(document.activeElement).toHaveClass('details-chart__body');
    await waitFor(() => {
      expect(chartRegion()).toBeInTheDocument();
    });
  });

  it('never caches a failure: coming back to a range retries it', async () => {
    const { requests, find } = controlHistory();
    select('AAPL');
    render(<StockDetail />);
    await act(async () => {
      find('AAPL', '1D').reject(new ApiError('PROVIDER_ERROR', 'Provider down', 502));
      await Promise.resolve();
    });
    expect(await screen.findByText('Provider down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: '1W' }));
    await userEvent.click(screen.getByRole('radio', { name: '1D' }));
    expect(requests.filter((r) => r.range === '1D')).toHaveLength(2);
    expect(screen.getByText('Loading price history…')).toBeInTheDocument();
  });

  it('shows only the latest range when earlier requests finish late', async () => {
    const { find } = controlHistory();
    select('AAPL');
    render(<StockDetail />);
    await userEvent.click(screen.getByRole('radio', { name: '1M' }));
    await userEvent.click(screen.getByRole('radio', { name: '3M' }));
    expect(find('AAPL', '1D').signal?.aborted).toBe(true);
    expect(find('AAPL', '1M').signal?.aborted).toBe(true);

    await act(async () => {
      find('AAPL', '3M').resolve(history('AAPL', '3M', [30, 31, 32]));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(seriesOf(liveChart(), 'Candlestick').data).toHaveLength(3);
    });
    await act(async () => {
      find('AAPL', '1M').resolve(history('AAPL', '1M', [10, 11, 12, 13, 14]));
      find('AAPL', '1D').resolve(history('AAPL', '1D', [1, 2]));
      await Promise.resolve();
    });
    expect(seriesOf(liveChart(), 'Candlestick').data).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '3M' })).toBeChecked();
  });

  it('never shows the previous symbol’s chart after the selection changes', async () => {
    const { find } = controlHistory();
    select('AAPL');
    render(<StockDetail />);
    select('MSFT');
    await act(async () => {
      find('AAPL', '1D').resolve(history('AAPL', '1D', [1, 2, 3, 4]));
      await Promise.resolve();
    });
    expect(screen.getByText('Loading price history…')).toBeInTheDocument();
    expect(mockCharts).toHaveLength(0);

    await act(async () => {
      find('MSFT', '1D').resolve(history('MSFT', '1D', [5, 6]));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(seriesOf(liveChart(), 'Candlestick').data).toHaveLength(2);
    });
  });

  it('keeps the chosen range when the selection changes', async () => {
    const { find } = controlHistory();
    select('AAPL');
    render(<StockDetail />);
    await userEvent.click(screen.getByRole('radio', { name: '6M' }));
    select('MSFT');
    expect(screen.getByRole('radio', { name: '6M' })).toBeChecked();
    expect(find('MSFT', '6M')).toBeDefined();
  });

  it('serves a range it already loaded from the cache', async () => {
    const { spy, find } = controlHistory();
    select('AAPL');
    render(<StockDetail />);
    await act(async () => {
      find('AAPL', '1D').resolve(history('AAPL', '1D', [1, 2]));
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole('radio', { name: '1W' }));
    await userEvent.click(screen.getByRole('radio', { name: '1D' }));
    expect(screen.queryByText('Loading price history…')).toBeNull();
    expect(chartRegion()).toBeInTheDocument();
    expect(spy.mock.calls.filter(([, range]) => range === '1D')).toHaveLength(1);
  });

  it('requests history and company details once under StrictMode', async () => {
    const { spy } = controlHistory();
    const instrumentSpy = vi.spyOn(api, 'getInstrument');
    select('AAPL');
    render(
      <StrictMode>
        <StockDetail />
      </StrictMode>,
    );
    expect(await screen.findByText('Apple Inc.')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(instrumentSpy).toHaveBeenCalledTimes(1);
  });

  it('moves the live line on ticks without fetching history again', async () => {
    const { spy, find } = controlHistory();
    act(() => {
      useQuoteStore.getState().applyBatch([quote({ last: 3.5 })]);
    });
    select('AAPL');
    render(<StockDetail />);
    await act(async () => {
      find('AAPL', '1D').resolve(history('AAPL', '1D', [1, 2, 3]));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chartRegion()).toBeInTheDocument();
    });
    const candles = seriesOf(liveChart(), 'Candlestick');
    expect(candles.priceLines[0]?.options).toMatchObject({ price: 3.5, title: 'Live' });

    act(() => {
      useQuoteStore.getState().applyBatch([quote({ last: 3.75 })]);
    });
    expect(candles.priceLines[0]?.options.price).toBe(3.75);
    expect(candles.setData).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('StockDetail quick view', () => {
  it('opens on the range and chart style from the settings, without a style toggle', async () => {
    act(() => {
      useSettingsStore.getState().update({ defaultChartRange: '3M', chartStyle: 'line' });
    });
    const { find } = controlHistory();
    select('AAPL');
    render(<StockDetail expandable />);
    expect(screen.getByRole('radio', { name: '3M' })).toBeChecked();
    expect(screen.queryByRole('radiogroup', { name: 'Chart style' })).toBeNull();
    await act(async () => {
      find('AAPL', '3M').resolve(history('AAPL', '3M', [1, 2, 3]));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(seriesOf(liveChart(), 'Line').data).toHaveLength(3);
    });
  });

  it('opens the full page from Expand', async () => {
    const location = memoryLocation({ path: '/watchlist', record: true });
    select('BTC/USD');
    render(
      <Router hook={location.hook}>
        <StockDetail expandable />
      </Router>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open BTC/USD full page' }));
    expect(location.history.at(-1)).toBe('/symbol/BTC%2FUSD');
  });

  it('has no Expand button outside the quick view', () => {
    select('AAPL');
    render(<StockDetail />);
    expect(screen.queryByRole('button', { name: /full page/ })).toBeNull();
  });
});
