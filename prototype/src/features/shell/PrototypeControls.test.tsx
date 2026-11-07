import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../app/uiStore';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { DEFAULT_SIMULATION } from '../../data/simulation';
import { getSimulation, updateSimulation } from '../../data/simulationStore';
import { useWatchlistStore } from '../watchlists/watchlistStore';
import { PrototypeControls } from './PrototypeControls';
import { resetShellStores } from './testUtils';

beforeEach(async () => {
  resetShellStores();
  await resetDemoData();
});

afterEach(() => {
  resetShellStores();
  act(() => {
    dismissAllToasts();
  });
});

function renderOpen() {
  const user = userEvent.setup();
  render(<PrototypeControls />);
  act(() => {
    useUiStore.getState().setPrototypeControlsOpen(true);
  });
  return { user, dialog: screen.getByRole('dialog', { name: 'Simulation controls' }) };
}

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

describe('PrototypeControls', () => {
  it('stays closed until the UI store opens it, and says it is prototype only', () => {
    render(<PrototypeControls />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => {
      useUiStore.getState().setPrototypeControlsOpen(true);
    });
    expect(screen.getByRole('dialog', { name: 'Simulation controls' })).toHaveAccessibleDescription(
      /Prototype only/,
    );
  });

  it('starts focus on the selected feed scenario', () => {
    renderOpen();
    expect(screen.getByRole('radio', { name: 'Live' })).toHaveFocus();
  });

  it('switches the feed scenario and explains each option', async () => {
    const { user } = renderOpen();
    const flaky = screen.getByRole('radio', { name: 'Flaky' });
    expect(flaky).toHaveAccessibleDescription('Drops every 20 seconds and recovers about 4 seconds later.');
    await user.click(flaky);
    expect(getSimulation().feedScenario).toBe('flaky');
    expect(flaky).toBeChecked();
    await user.keyboard('{ArrowUp}');
    expect(getSimulation().feedScenario).toBe('disconnected');
  });

  it('sets ticks per second and API latency within their ranges', () => {
    renderOpen();
    const ticks = screen.getByRole('slider', { name: 'Ticks per second' });
    expect(ticks).toHaveAttribute('min', '1');
    expect(ticks).toHaveAttribute('max', '50');
    fireEvent.change(ticks, { target: { value: '30' } });
    expect(getSimulation().ticksPerSecond).toBe(30);
    expect(ticks).toHaveAttribute('aria-valuetext', '30 per second');
    expect(screen.getByText('30/s', { selector: 'output' })).toBeInTheDocument();

    const latency = screen.getByRole('slider', { name: 'API latency' });
    expect(latency).toHaveAttribute('max', '3000');
    fireEvent.change(latency, { target: { value: '1200' } });
    expect(getSimulation().apiLatencyMs).toBe(1200);
    expect(screen.getByText('1200 ms', { selector: 'output' })).toBeInTheDocument();
  });

  it('arms a one-shot API failure that turns itself off after the next call', async () => {
    const { user } = renderOpen();
    act(() => {
      updateSimulation({ apiLatencyMs: 0 });
    });
    const fail = screen.getByRole('switch', { name: 'Fail the next API call' });
    await user.click(fail);
    expect(fail).toBeChecked();
    await act(async () => {
      await api.listWatchlists().catch(() => undefined);
    });
    expect(fail).not.toBeChecked();
  });

  it('picks the history scenario and describes it', async () => {
    const { user } = renderOpen();
    const history = screen.getByRole('radiogroup', { name: 'History scenario' });
    await user.click(within(history).getByRole('radio', { name: 'Error' }));
    expect(getSimulation().historyScenario).toBe('error');
    expect(screen.getByText('Chart history requests fail with a provider error.')).toBeInTheDocument();
  });

  it('restores the default settings', async () => {
    const { user } = renderOpen();
    const restore = screen.getByRole('button', { name: 'Restore defaults' });
    expect(restore).toBeDisabled();
    act(() => {
      updateSimulation({ feedScenario: 'stale', ticksPerSecond: 40, historyScenario: 'slow' });
    });
    await user.click(restore);
    expect(getSimulation()).toEqual(DEFAULT_SIMULATION);
    expect(restore).toBeDisabled();
    // Focus stays inside the dialog instead of falling to the page behind it.
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('closes with Done and with Escape', async () => {
    const { user } = renderOpen();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(useUiStore.getState().prototypeControlsOpen).toBe(false);
    act(() => {
      useUiStore.getState().setPrototypeControlsOpen(true);
    });
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().prototypeControlsOpen).toBe(false);
  });

  it('works under StrictMode', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <PrototypeControls />
      </StrictMode>,
    );
    act(() => {
      useUiStore.getState().setPrototypeControlsOpen(true);
    });
    await user.click(screen.getByRole('radio', { name: 'Delayed' }));
    expect(getSimulation().feedScenario).toBe('delayed');
  });
});

describe('Reset demo data', () => {
  it('asks first and does nothing when cancelled', async () => {
    const { user } = renderOpen();
    let loads = 0;
    act(() => {
      useWatchlistStore.setState({
        load: () => {
          loads += 1;
          return Promise.resolve();
        },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Reset demo data…' }));
    const confirm = screen.getByRole('dialog', { name: 'Reset demo data?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Reset demo data?' })).not.toBeInTheDocument();
    expect(loads).toBe(0);
    expect(toastTitles()).toEqual([]);
  });

  it('restores the seeded data, reloads the stores and confirms with a toast', async () => {
    const { user } = renderOpen();
    act(() => {
      updateSimulation({ apiLatencyMs: 0 });
    });
    await api.createWatchlist({ name: 'Scratch' });
    let loads = 0;
    act(() => {
      useWatchlistStore.setState({
        load: () => {
          loads += 1;
          return Promise.resolve();
        },
      });
    });

    await user.click(screen.getByRole('button', { name: 'Reset demo data…' }));
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));

    await waitFor(() => {
      expect(toastTitles()).toEqual(['Demo data reset']);
    });
    expect(screen.queryByRole('dialog', { name: 'Reset demo data?' })).not.toBeInTheDocument();
    expect(loads).toBe(1);
    expect((await api.listWatchlists()).map((w) => w.name)).not.toContain('Scratch');
    // The controls stay open for further changes.
    expect(screen.getByRole('dialog', { name: 'Simulation controls' })).toBeInTheDocument();
  });

  it('shows the confirm as busy while reloading and resets only once on repeated clicks', async () => {
    const { user } = renderOpen();
    let finish: () => void = () => undefined;
    let loads = 0;
    act(() => {
      useWatchlistStore.setState({
        load: () => {
          loads += 1;
          return new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      });
    });

    await user.click(screen.getByRole('button', { name: 'Reset demo data…' }));
    const confirmButton = screen.getByRole('button', { name: 'Reset demo data' });
    await user.click(confirmButton);
    await user.click(confirmButton);
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Reset demo data?' })).toBeInTheDocument();

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(toastTitles()).toEqual(['Demo data reset']);
    });
    expect(loads).toBe(1);
  });

  it('warns when the data was reset but a store failed to reload', async () => {
    const { user } = renderOpen();
    act(() => {
      useWatchlistStore.setState({
        load: () => {
          useWatchlistStore.setState({ status: 'error', error: 'The service is unavailable.' });
          return Promise.resolve();
        },
      });
    });
    await user.click(screen.getByRole('button', { name: 'Reset demo data…' }));
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts).toMatchObject([
        {
          tone: 'warning',
          title: 'Demo data reset, but reloading failed',
          description: 'Watchlists did not reload: The service is unavailable.',
        },
      ]);
    });
  });
});
