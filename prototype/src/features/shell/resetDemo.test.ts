import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, resetDemoData } from '../../data/dataLayer';
import { SEED_WATCHLIST_SYMBOLS } from '../../data/mock/seed';
import { updateSimulation } from '../../data/simulationStore';
import { useAlertStore } from '../alerts/alertStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { resetDemoAndReload } from './resetDemo';
import { resetShellStores } from './testUtils';

beforeEach(async () => {
  resetShellStores();
  updateSimulation({ apiLatencyMs: 0 });
  await resetDemoData();
});

afterEach(() => {
  resetShellStores();
});

describe('resetDemoAndReload', () => {
  it('restores the seeded watchlist and alerts and reloads both stores', async () => {
    const seededAlerts = (await api.listAlerts()).length;
    await api.addSymbol('SPY');
    await api.removeSymbol('AAPL');
    await api.deleteAlert((await api.listAlerts())[0]!.id);
    const loaded: string[] = [];
    useWatchlistStore.setState({
      load: () => {
        loaded.push('watchlist');
        return Promise.resolve();
      },
    });
    useAlertStore.setState({
      load: () => {
        loaded.push('alerts');
        return Promise.resolve();
      },
    });

    await expect(resetDemoAndReload()).resolves.toEqual({ ok: true });
    expect((await api.getWatchlist()).symbols).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(await api.listAlerts()).toHaveLength(seededAlerts);
    expect(loaded.sort()).toEqual(['alerts', 'watchlist']);
  });

  it('reloads the reset data even while loads from before the reset are still in flight', async () => {
    await api.addSymbol('SPY');
    await api.deleteAlert('alert-seed-tsla');
    const staleWatchlist = await api.getWatchlist();
    const staleAlerts = await api.listAlerts();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(api, 'getWatchlist').mockImplementationOnce(async () => {
      await gate;
      return staleWatchlist;
    });
    vi.spyOn(api, 'listAlerts').mockImplementationOnce(async () => {
      await gate;
      return staleAlerts;
    });
    const staleLoads = [useWatchlistStore.getState().load(), useAlertStore.getState().load()];

    await expect(resetDemoAndReload()).resolves.toEqual({ ok: true });
    const symbols = () => useWatchlistStore.getState().watchlist?.symbols;
    const alertIds = () => useAlertStore.getState().alerts.map((a) => a.id);
    expect(symbols()).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(alertIds()).toContain('alert-seed-tsla');

    release();
    await Promise.all(staleLoads);
    expect(symbols()).toEqual(SEED_WATCHLIST_SYMBOLS);
    expect(alertIds()).toContain('alert-seed-tsla');
  });

  it('reports every store that ended its reload in error', async () => {
    useWatchlistStore.setState({
      load: () => {
        useWatchlistStore.setState({ status: 'error', error: 'The service is unavailable.' });
        return Promise.resolve();
      },
    });
    useAlertStore.setState({
      load: () => {
        useAlertStore.setState({ status: 'error', error: null });
        return Promise.resolve();
      },
    });
    await expect(resetDemoAndReload()).resolves.toEqual({
      ok: false,
      dataReset: true,
      message: 'Watchlist did not reload: The service is unavailable. Alerts did not reload: Unknown error.',
    });
  });

  it('still reloads alerts when the watchlist load breaks its contract and rejects', async () => {
    let alertsLoaded = false;
    useWatchlistStore.setState({ load: () => Promise.reject(new Error('boom')) });
    useAlertStore.setState({
      load: () => {
        alertsLoaded = true;
        return Promise.resolve();
      },
    });
    await expect(resetDemoAndReload()).resolves.toEqual({
      ok: false,
      dataReset: true,
      message: 'Watchlist did not reload: boom',
    });
    expect(alertsLoaded).toBe(true);
  });
});
