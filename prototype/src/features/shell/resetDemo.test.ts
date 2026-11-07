import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, resetDemoData } from '../../data/dataLayer';
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
  it('restores the seeded watchlists and alerts and reloads both stores', async () => {
    const seededWatchlists = (await api.listWatchlists()).map((w) => w.name);
    const seededAlerts = (await api.listAlerts()).length;
    await api.createWatchlist({ name: 'Scratch' });
    await api.deleteAlert((await api.listAlerts())[0]!.id);
    const loaded: string[] = [];
    useWatchlistStore.setState({
      load: () => {
        loaded.push('watchlists');
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
    expect((await api.listWatchlists()).map((w) => w.name)).toEqual(seededWatchlists);
    expect(await api.listAlerts()).toHaveLength(seededAlerts);
    expect(loaded.sort()).toEqual(['alerts', 'watchlists']);
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
      message: 'Watchlists did not reload: The service is unavailable. Alerts did not reload: Unknown error.',
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
      message: 'Watchlists did not reload: boom',
    });
    expect(alertsLoaded).toBe(true);
  });
});
