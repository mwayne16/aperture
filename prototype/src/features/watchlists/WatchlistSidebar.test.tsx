import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStartup } from '../../app/useAppStartup';
import { useTheme } from '../../components/ui/theme';
import { dismissAllToasts, useToastStore } from '../../components/ui/toastStore';
import { api, resetDemoData } from '../../data/dataLayer';
import { resetSimulation, updateSimulation } from '../../data/simulationStore';
import { WatchlistSidebar } from './WatchlistSidebar';
import { useWatchlistStore } from './watchlistStore';

const item = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ symbols?$`) });
const queryItem = (name: string) =>
  screen.queryByRole('button', { name: new RegExp(`^${name}, \\d+ symbols?$`) });
const menuTrigger = (name: string) => screen.getByRole('button', { name: `Actions for ${name}` });
const failNextCall = () => {
  updateSimulation({ failNextApiCall: true });
};

// ** Typing and tabbing through userEvent can take seconds when other test files run in parallel.
// A timed-out flow keeps typing into the next test's dialog, so give each flow room to finish.
vi.setConfig({ testTimeout: 20_000 });

beforeEach(async () => {
  updateSimulation({ apiLatencyMs: 0, failNextApiCall: false });
  await resetDemoData();
  useWatchlistStore.setState({ status: 'idle', error: null, watchlists: [], activeId: null });
  dismissAllToasts();
});

afterEach(() => {
  resetSimulation();
});

async function load() {
  await act(() => useWatchlistStore.getState().load());
}

async function renderLoaded() {
  const user = userEvent.setup();
  const view = render(<WatchlistSidebar />);
  await load();
  return { user, ...view };
}

describe('loading', () => {
  it('shows placeholder rows until the first load finishes', async () => {
    render(<WatchlistSidebar />);
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = useWatchlistStore.getState().load();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading watchlists');
    expect(screen.getByRole('button', { name: 'New watchlist' })).toBeDisabled();
    await act(() => pending);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(item('Core Tech')).toBeInTheDocument();
  });

  it('loads once and shows the lists when mounted by the app under StrictMode', async () => {
    const listWatchlists = vi.spyOn(api, 'listWatchlists');
    function Startup() {
      useAppStartup();
      return <WatchlistSidebar />;
    }
    render(
      <StrictMode>
        <Startup />
      </StrictMode>,
    );
    expect(await screen.findByRole('button', { name: 'Core Tech, 10 symbols' })).toBeInTheDocument();
    expect(listWatchlists).toHaveBeenCalledTimes(1);
  });

  it('shows the error with Retry when loading fails, then recovers', async () => {
    const user = userEvent.setup();
    render(<WatchlistSidebar />);
    failNextCall();
    await load();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load watchlists");
    expect(alert).toHaveTextContent(/temporarily unavailable/);
    expect(screen.getByRole('button', { name: 'New watchlist' })).toBeDisabled();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(item('Core Tech')).toHaveFocus();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the lists and offers Retry when a refresh fails', async () => {
    const { user } = await renderLoaded();
    failNextCall();
    await load();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't refresh watchlists.");
    expect(item('Core Tech')).toHaveAttribute('aria-current', 'true');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows an empty state that creates the first list', async () => {
    vi.spyOn(api, 'listWatchlists').mockResolvedValueOnce([]);
    const { user } = await renderLoaded();
    expect(screen.getByText('No watchlists')).toBeInTheDocument();
    const [, createButton] = screen.getAllByRole('button', { name: 'New watchlist' });
    await user.click(createButton!);
    expect(screen.getByRole('dialog', { name: 'New watchlist' })).toBeInTheDocument();

    // The empty state's button is gone once the list exists, so focus moves to the new list.
    await user.keyboard('Semis{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(item('Semis')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => {
      expect(item('Semis')).toHaveFocus();
    });
  });
});

describe('list', () => {
  it('shows each list with its symbol count and marks the active one', async () => {
    await renderLoaded();
    expect(screen.getByRole('list', { name: 'Watchlists' })).toBeInTheDocument();
    expect(item('Core Tech')).toHaveAccessibleName('Core Tech, 10 symbols');
    expect(item('Ideas')).toHaveAccessibleName('Ideas, 0 symbols');
    expect(item('Core Tech')).toHaveAttribute('aria-current', 'true');
    expect(item('Ideas')).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Simulated')).toBeInTheDocument();
  });

  it('activates a list on click and keeps it active after a reload', async () => {
    const { user, unmount } = await renderLoaded();
    await user.click(item('Index ETFs'));
    expect(item('Index ETFs')).toHaveAttribute('aria-current', 'true');
    expect(item('Core Tech')).not.toHaveAttribute('aria-current');

    unmount();
    useWatchlistStore.setState({ status: 'idle', watchlists: [], activeId: null });
    await renderLoaded();
    expect(item('Index ETFs')).toHaveAttribute('aria-current', 'true');
  });

  it('has one Tab stop and moves between lists with the arrow keys', async () => {
    const { user } = await renderLoaded();
    await user.tab();
    expect(screen.getByRole('button', { name: 'New watchlist' })).toHaveFocus();
    await user.tab();
    expect(item('Core Tech')).toHaveFocus();
    await user.tab();
    expect(menuTrigger('Core Tech')).toHaveFocus();

    await user.tab({ shift: true });
    await user.keyboard('{ArrowDown}');
    expect(item('Index ETFs')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Ideas')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Ideas')).toHaveFocus();
    await user.keyboard('{Home}{ArrowDown}{Enter}');
    expect(item('Index ETFs')).toHaveAttribute('aria-current', 'true');

    // The Tab stop follows focus, so leaving and coming back returns to the same list.
    await user.keyboard('{ArrowDown}');
    await user.tab({ shift: true });
    await user.tab();
    expect(item('Financials')).toHaveFocus();
  });

  it('keeps showing the store after a theme switch', async () => {
    const { user } = await renderLoaded();
    function ThemeToggle() {
      const { resolved, setPreference } = useTheme();
      return (
        <button
          type="button"
          onClick={() => {
            setPreference(resolved === 'dark' ? 'light' : 'dark');
          }}
        >
          Toggle theme
        </button>
      );
    }
    render(<ThemeToggle />);
    await user.click(item('Financials'));
    const before = document.documentElement.dataset.theme;
    await user.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(document.documentElement.dataset.theme).not.toBe(before);
    expect(item('Financials')).toHaveAttribute('aria-current', 'true');
  });
});

describe('create and rename', () => {
  it('validates the name inline before creating, then activates the new list', async () => {
    const { user } = await renderLoaded();
    const createWatchlist = vi.spyOn(api, 'createWatchlist');
    await user.click(screen.getByRole('button', { name: 'New watchlist' }));
    const dialog = screen.getByRole('dialog', { name: 'New watchlist' });
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(input).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(input).toHaveAccessibleDescription('Enter a watchlist name.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();

    await user.type(input, 'core tech');
    expect(input).toHaveAccessibleDescription('You already have a watchlist with this name.');
    await user.clear(input);
    await user.type(input, 'Energy');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(createWatchlist).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(createWatchlist).toHaveBeenCalledTimes(1);
    expect(item('Energy')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New watchlist' })).toHaveFocus();
    });
  });

  it('shows a server error inside the dialog and lets the user try again', async () => {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'New watchlist' }));
    const dialog = screen.getByRole('dialog', { name: 'New watchlist' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Energy');
    failNextCall();
    await user.keyboard('{Enter}');

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/temporarily unavailable/);
    expect(dialog).toBeInTheDocument();
    expect(queryItem('Energy')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(item('Energy')).toBeInTheDocument();
  });

  it('submits once when Enter is pressed repeatedly on a slow connection', async () => {
    const { user } = await renderLoaded();
    const real = api.createWatchlist.bind(api);
    const gates: (() => void)[] = [];
    const createWatchlist = vi.spyOn(api, 'createWatchlist').mockImplementation(async (input) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return real(input);
    });
    await user.click(screen.getByRole('button', { name: 'New watchlist' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Energy{Enter}{Enter}');
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'New watchlist' })).toBeInTheDocument();

    for (const release of gates) release();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(createWatchlist).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: /^Energy, / })).toHaveLength(1);
  });

  it('renames a list from its menu and returns focus to the menu button', async () => {
    const { user } = await renderLoaded();
    await user.click(menuTrigger('Ideas'));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename watchlist' });
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Ideas');

    await user.keyboard('Watch next{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(item('Watch next')).toBeInTheDocument();
    expect(queryItem('Ideas')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(menuTrigger('Watch next')).toHaveFocus();
    });
  });

  it('opens rename with F2 and keeps the old name on cancel', async () => {
    const { user } = await renderLoaded();
    item('Financials').focus();
    await user.keyboard('{F2}');
    const dialog = screen.getByRole('dialog', { name: 'Rename watchlist' });
    await user.keyboard('Banks');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(item('Financials')).toBeInTheDocument();
    await waitFor(() => {
      expect(item('Financials')).toHaveFocus();
    });
  });
});

describe('delete', () => {
  it('asks first, naming the list and its symbol count, then activates the next list', async () => {
    const { user } = await renderLoaded();
    await user.click(menuTrigger('Core Tech'));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete watchlist?' });
    expect(dialog).toHaveAccessibleDescription(
      '“Core Tech” and its 10 symbols will be deleted. Alerts are kept.',
    );

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(queryItem('Core Tech')).not.toBeInTheDocument();
    expect(item('Index ETFs')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => {
      expect(item('Index ETFs')).toHaveFocus();
    });
  });

  it('keeps the list when the delete is cancelled', async () => {
    const { user } = await renderLoaded();
    item('Ideas').focus();
    await user.keyboard('{Delete}');
    const dialog = screen.getByRole('dialog', { name: 'Delete watchlist?' });
    expect(dialog).toHaveAccessibleDescription('“Ideas” will be deleted. Alerts are kept.');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(item('Ideas')).toBeInTheDocument();
  });

  it('brings the list back and reports it when the delete fails', async () => {
    const { user } = await renderLoaded();
    item('Ideas').focus();
    await user.keyboard('{Delete}');
    failNextCall();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(item('Ideas')).toBeInTheDocument();
    });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toEqual(["Couldn't delete “Ideas”"]);
  });

  it('shows the empty state after the last list is deleted', async () => {
    const { user } = await renderLoaded();
    for (const name of ['Core Tech', 'Index ETFs', 'Financials', 'Ideas']) {
      item(name).focus();
      await user.keyboard('{Delete}');
      await user.click(screen.getByRole('button', { name: 'Delete' }));
    }
    expect(screen.getByText('No watchlists')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'New watchlist' })[1]).toHaveFocus();
    });
  });
});
