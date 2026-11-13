import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { ApiError } from '../../data/api';
import { api, resetDemoData } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import type { AlertEvent, MarketMovers, Quote } from '../../domain/types';
import { useAlertStore } from '../alerts/alertStore';
import { instrumentCatalog } from '../discover/instrumentCatalog';
import { sparklineCache } from '../discover/sparklineCache';
import { quote, resetShellStores, setQuotes } from '../shell/testUtils';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { DashboardPage } from './DashboardPage';
import { greetingFor } from './marketGreeting';

function renderDashboard({ strict = false } = {}) {
  const location = memoryLocation({ path: '/' });
  const tree = (
    <Router hook={location.hook}>
      <DashboardPage />
    </Router>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function card(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

const unavailable = () => new ApiError('UNAVAILABLE', 'Service down (simulated).', 503);

function moverQuote(symbol: string, changePct: number, volume: number): Quote {
  return { ...quote(symbol, 'live'), change: changePct, changePct, volume };
}

const MOVERS: MarketMovers = {
  gainers: [moverQuote('PLTR', 4.2, 1_000), moverQuote('AMD', 2.1, 2_000)],
  losers: [moverQuote('INTC', -3.3, 3_000)],
  mostActive: [moverQuote('NVDA', 0.4, 240_000_000)],
  asOf: Date.UTC(2026, 10, 9, 15, 30, 5),
  simulated: true,
};

function alertEvent(id: string, symbol: string, minutesAgo: number): AlertEvent {
  return {
    id,
    alertId: `alert-${id}`,
    symbol,
    condition: 'above',
    targetPrice: 200,
    tag: 'buy',
    field: 'last',
    price: 201.5,
    triggeredAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

beforeEach(async () => {
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
  instrumentCatalog.clear();
  sparklineCache.clear();
  // ** Sparklines have their own tests; here they stay loading so their history requests don't race the page.
  vi.spyOn(sparklineCache, 'load').mockReturnValue(new Promise(() => undefined));
});

describe('Dashboard header', () => {
  it('greets by local time and shows the US session with the New York clock', () => {
    // Tuesday Nov 10 2026, 10:15:30 in New York.
    vi.setSystemTime(Date.UTC(2026, 10, 10, 15, 15, 30));
    try {
      renderDashboard();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(greetingFor(new Date()));
      expect(screen.getByText('Market open')).toBeInTheDocument();
      expect(screen.getByText('US stock markets are open until 16:00 ET.')).toBeInTheDocument();
      expect(screen.getByText('Tuesday, November 10')).toBeInTheDocument();
      expect(screen.getByText('New York 10:15:30')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Markets strip', () => {
  it('shows the index ETFs and Bitcoin, labelled as such, with prices and freshness', async () => {
    renderDashboard();
    const strip = card('Markets');
    expect(within(strip).getByText('Index ETFs, since the feed has no index values')).toBeInTheDocument();
    expect(within(strip).getByText('Simulated')).toBeInTheDocument();
    expect(await within(strip).findByText(/as of \d{2}:\d{2}:\d{2} ET/)).toBeInTheDocument();
    for (const [name, symbol] of [
      ['S&P 500', 'SPY · ETF'],
      ['Nasdaq-100', 'QQQ · ETF'],
      ['Dow Jones', 'DIA · ETF'],
      ['Russell 2000', 'IWM · ETF'],
      ['Bitcoin', 'BTC/USD · 24/7'],
    ] as const) {
      const tile = within(strip).getByRole('link', {
        name: new RegExp(`^${name} ${symbol.replace('/', '\\/')}`),
      });
      expect(tile.textContent).toMatch(/\d\.\d{2}/);
    }
    expect(within(strip).getByRole('link', { name: /^Bitcoin/ })).toHaveAttribute(
      'href',
      '/symbol/BTC%2FUSD',
    );
  });

  it('shows an error with Retry when prices fail to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getSnapshots').mockRejectedValueOnce(unavailable());
    renderDashboard();
    const strip = card('Markets');
    const alert = await within(strip).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load market prices");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(strip).findByText(/as of/)).toBeInTheDocument();
    expect(within(strip).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Your watchlist card', () => {
  it('lists the watchlist with live prices and links to it', async () => {
    await act(() => useWatchlistStore.getState().load());
    setQuotes([{ ...quote('AAPL', 'live'), last: 235.59, changePct: 0.5 }]);
    renderDashboard();
    const watchlist = card('Your watchlist');
    const aapl = within(watchlist).getByRole('link', { name: /^AAPL/ });
    expect(aapl).toHaveAttribute('href', '/symbol/AAPL');
    expect(aapl).toHaveTextContent('235.59');
    expect(aapl).toHaveTextContent('+0.50%');
    expect(await within(watchlist).findByRole('link', { name: /^AAPL Apple Inc\./ })).toBeInTheDocument();
    // The seeded watchlist holds ten symbols; eight fit, the rest are a link away.
    expect(within(watchlist).getAllByRole('listitem')).toHaveLength(8);
    expect(within(watchlist).getByRole('link', { name: '2 more in your watchlist' })).toHaveAttribute(
      'href',
      '/watchlist',
    );
    expect(within(watchlist).getByRole('link', { name: 'Open watchlist' })).toHaveAttribute('href', '/watchlist');
  });

  it('points an empty watchlist to Discover', () => {
    act(() => {
      useWatchlistStore.setState({ status: 'ready', watchlist: { symbols: [], updatedAt: '' } });
    });
    renderDashboard();
    const watchlist = card('Your watchlist');
    expect(within(watchlist).getByText('Your watchlist is empty')).toBeInTheDocument();
    expect(within(watchlist).getByRole('link', { name: 'Discover' })).toHaveAttribute(
      'href',
      '/discover/stocks',
    );
    expect(within(watchlist).getByRole('link', { name: 'Open watchlist' })).toHaveAttribute('href', '/watchlist');
  });

  it('shows an error with Retry when the watchlist fails to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getWatchlist').mockRejectedValueOnce(unavailable());
    await act(() => useWatchlistStore.getState().load());
    renderDashboard();
    const watchlist = card('Your watchlist');
    const alert = within(watchlist).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your watchlist");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(watchlist).findByRole('link', { name: /^AAPL/ })).toBeInTheDocument();
  });

  it('shows placeholders while the watchlist loads', () => {
    act(() => {
      useWatchlistStore.setState({ status: 'loading' });
    });
    renderDashboard();
    expect(card('Your watchlist').querySelector('.dash-skeleton-row')).not.toBeNull();
  });
});

describe('Top movers card', () => {
  it('switches between gainers, losers and the most active stocks', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getMovers').mockResolvedValue(MOVERS);
    renderDashboard();
    const movers = card('Top movers');
    expect(await within(movers).findByRole('link', { name: /^PLTR/ })).toHaveAttribute(
      'href',
      '/symbol/PLTR',
    );
    expect(within(movers).getByRole('link', { name: /^AMD/ })).toHaveTextContent('+2.10%');
    expect(within(movers).getByText('as of 10:30:05 ET')).toBeInTheDocument();
    expect(within(movers).getByText('Simulated')).toBeInTheDocument();

    await user.click(within(movers).getByRole('radio', { name: 'Losers' }));
    expect(within(movers).getByRole('link', { name: /^INTC/ })).toHaveTextContent('−3.30%');
    expect(within(movers).queryByRole('link', { name: /^PLTR/ })).not.toBeInTheDocument();

    await user.click(within(movers).getByRole('radio', { name: 'Most active' }));
    expect(within(movers).getByRole('link', { name: /^NVDA/ })).toHaveTextContent('240M');
  });

  it('says so when a list is empty', async () => {
    vi.spyOn(api, 'getMovers').mockResolvedValue({ ...MOVERS, gainers: [] });
    renderDashboard();
    expect(await within(card('Top movers')).findByText('No stocks are up today')).toBeInTheDocument();
  });

  it('shows an error with Retry when the ranking fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getMovers').mockRejectedValueOnce(unavailable()).mockResolvedValue(MOVERS);
    renderDashboard();
    const movers = card('Top movers');
    const alert = await within(movers).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load top movers");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(movers).findByRole('link', { name: /^PLTR/ })).toBeInTheDocument();
  });
});

describe('Recent alerts card', () => {
  it('lists the latest triggers, newest first, linking to their symbols', async () => {
    await act(() => useAlertStore.getState().load());
    act(() => {
      useAlertStore.getState().recordEvent(alertEvent('e1', 'AAPL', 5));
      useAlertStore.getState().recordEvent(alertEvent('e2', 'MSFT', 1.5));
    });
    renderDashboard();
    const alerts = card('Recent alerts');
    const rows = within(alerts).getAllByRole('link', { name: /Last ≥ 200\.00/ });
    expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/symbol/MSFT', '/symbol/AAPL']);
    expect(rows[0]).toHaveTextContent('201.50');
    expect(rows[0]).toHaveTextContent('Buy');
    expect(rows[0]).toHaveTextContent('1m ago');
    expect(within(alerts).getByRole('link', { name: 'All alerts' })).toHaveAttribute('href', '/alerts');
  });

  it('shows how many alerts are armed before any fire', async () => {
    await act(() => useAlertStore.getState().load());
    const { alerts } = useAlertStore.getState();
    const armed = alerts.filter((a) => a.enabled && a.armed).length;
    renderDashboard();
    const alertsCard = card('Recent alerts');
    expect(within(alertsCard).getByText('No alerts have fired yet')).toBeInTheDocument();
    expect(
      within(alertsCard).getByText(new RegExp(`^${armed} of ${alerts.length} alerts`)),
    ).toBeInTheDocument();
  });

  it('shows an error with Retry when alerts fail to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'listAlerts').mockRejectedValueOnce(unavailable());
    await act(() => useAlertStore.getState().load());
    renderDashboard();
    const alert = within(card('Recent alerts')).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load alerts");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(card('Recent alerts')).findByText('No alerts have fired yet')).toBeInTheDocument();
  });
});

describe('Market news card', () => {
  it('marks every simulated story and gives it no headline link', async () => {
    renderDashboard();
    const news = card('Market news');
    const stories = await within(news).findAllByRole('article');
    expect(stories.length).toBe(6);
    for (const story of stories) {
      expect(within(story).getByText('Simulated')).toBeInTheDocument();
      const headline = within(story).getByRole('heading', { level: 3 });
      expect(within(headline).queryByRole('link')).not.toBeInTheDocument();
      // The only links are the symbols the story is about.
      for (const link of within(story).queryAllByRole('link')) {
        expect(link.getAttribute('href')).toMatch(/^\/symbol\//);
      }
    }
  });

  it('says so when there is no news', async () => {
    vi.spyOn(api, 'getNews').mockResolvedValue([]);
    renderDashboard();
    expect(await within(card('Market news')).findByText('No news right now')).toBeInTheDocument();
  });

  it('shows an error with Retry when news fails to load', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'getNews').mockRejectedValueOnce(unavailable());
    renderDashboard();
    const news = card('Market news');
    const alert = await within(news).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load news");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(news).findAllByRole('article')).toHaveLength(6);
  });
});

describe('Dashboard page', () => {
  it('loads every card under StrictMode', async () => {
    await act(() => useWatchlistStore.getState().load());
    renderDashboard({ strict: true });
    expect(await within(card('Markets')).findByText(/as of/)).toBeInTheDocument();
    expect(await within(card('Top movers')).findByText(/as of/)).toBeInTheDocument();
    expect(await within(card('Market news')).findAllByRole('article')).toHaveLength(6);
    expect(within(card('Your watchlist')).getAllByRole('listitem')).toHaveLength(8);
  });
});
