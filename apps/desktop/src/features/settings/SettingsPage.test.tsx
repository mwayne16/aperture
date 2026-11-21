import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../../components/ui/theme';
import { useToastStore } from '../../components/ui/toastStore';
import { INITIAL_CONNECTION, useConnectionStore } from '../../data/connectionStore';
import { api } from '../../data/dataLayer';
import { updateSimulation } from '../../data/simulationStore';
import { useAlertStore } from '../alerts/alertStore';
import { resetAlertsTestState } from '../alerts/alertsTestHarness';
import { useNotificationStore } from '../notifications/notificationStore';
import { DEFAULT_SETTINGS } from './settingsRules';
import { SETTINGS_STORAGE_KEY, useSettingsStore } from './settingsStore';
import { SettingsPage } from './SettingsPage';

vi.setConfig({ testTimeout: 20_000 });

interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;

function renderPage() {
  const user = userEvent.setup();
  const view = render(<SettingsPage />);
  return { user, ...view };
}

const card = (title: string) => screen.getByRole('region', { name: title });
const settings = () => useSettingsStore.getState().settings;
const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

function ThemeProbe() {
  return <output data-testid="theme">{useTheme().resolved}</output>;
}

beforeEach(async () => {
  await resetAlertsTestState();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useNotificationStore.setState({ notifications: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsPage', () => {
  it('shows each section as a card under one page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    for (const title of ['Appearance', 'Notifications', 'Market data', 'Charts', 'Data', 'About']) {
      expect(card(title)).toBeInTheDocument();
    }
  });

  it('switches the theme', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SettingsPage />
        <ThemeProbe />
      </>,
    );
    const theme = card('Appearance');
    expect(within(theme).getByRole('radio', { name: 'System' })).toBeChecked();
    await user.click(within(theme).getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    await user.click(within(theme).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('aperture.theme')).toBe('dark');
  });

  it('turns trigger toasts off and on, and keeps desktop notifications for the desktop app', async () => {
    const { user } = renderPage();
    const notifications = card('Notifications');
    const toasts = within(notifications).getByRole('switch', { name: 'Trigger toasts' });
    expect(toasts).toBeChecked();
    expect(toasts).toHaveAccessibleDescription(/Every trigger is still recorded in Notifications/);
    await user.click(toasts);
    expect(settings().triggerToasts).toBe(false);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      triggerToasts: false,
    });

    const desktop = within(notifications).getByRole('switch', { name: 'Desktop notifications' });
    expect(desktop).toBeDisabled();
    expect(desktop).not.toBeChecked();
    expect(desktop).toHaveAccessibleDescription('Available in the desktop app.');
  });

  it('turns desktop notifications off and on in the desktop app', async () => {
    window.aperture = {
      platform: 'win32',
      versions: { electron: '45.0.0', chrome: '146.0.0' },
      notify: vi.fn(),
      onNotificationClick: () => () => undefined,
    };
    try {
      const { user } = renderPage();
      const desktop = within(card('Notifications')).getByRole('switch', { name: 'Desktop notifications' });
      expect(desktop).toBeEnabled();
      expect(desktop).toBeChecked();
      expect(desktop).toHaveAccessibleDescription(/while Aperture isn't in front/);
      await user.click(desktop);
      expect(settings().desktopNotifications).toBe(false);
      expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
        desktopNotifications: false,
      });
    } finally {
      delete window.aperture;
    }
  });

  it('sets the default chart range and style', async () => {
    const { user } = renderPage();
    const charts = card('Charts');
    await user.selectOptions(within(charts).getByRole('combobox', { name: 'Default range' }), '3 months');
    expect(settings().defaultChartRange).toBe('3M');
    await user.click(within(charts).getByRole('radio', { name: 'Line' }));
    expect(settings().chartStyle).toBe('line');
    expect(within(charts).getByRole('radio', { name: 'Line' })).toBeChecked();
  });

  it('describes the simulated source and the planned IEX feed honestly', () => {
    renderPage();
    const market = card('Market data');
    expect(within(market).getByText('Simulated feed')).toBeInTheDocument();
    expect(within(market).getByText('Simulated')).toBeInTheDocument();
    expect(within(market).getByText('Connected')).toBeInTheDocument();
    expect(within(market).getByText('Alpaca — IEX (free)')).toBeInTheDocument();
    expect(within(market).getByText(/from the IEX exchange only/)).toBeInTheDocument();
    expect(within(market).getByText(/Volume counts IEX trades only/)).toBeInTheDocument();
    expect(within(market).getByText(/No fundamentals/)).toBeInTheDocument();
    expect(within(market).getByText(/API keys are configured in the backend later/)).toBeInTheDocument();

    act(() => {
      useConnectionStore
        .getState()
        .setConnection({ ...INITIAL_CONNECTION, state: 'reconnecting', reconnectAttempt: 2 });
    });
    expect(within(market).getByText('Reconnecting (attempt 2)')).toBeInTheDocument();
  });

  it('resets the demo data after confirmation', async () => {
    await useAlertStore.getState().load();
    const msft = useAlertStore.getState().alerts.find((a) => a.symbol === 'MSFT')!;
    await api.deleteAlert(msft.id);
    await useAlertStore.getState().load({ force: true });
    expect(useAlertStore.getState().alerts).toHaveLength(3);

    const { user } = renderPage();
    await user.click(within(card('Data')).getByRole('button', { name: 'Reset demo data…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset demo data?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset demo data' }));
    await waitFor(() => {
      expect(toastTitles()).toContain('Demo data reset');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useAlertStore.getState().alerts).toHaveLength(4);
  });

  it('reports a failed reload after a reset', async () => {
    const { user } = renderPage();
    await user.click(within(card('Data')).getByRole('button', { name: 'Reset demo data…' }));
    vi.spyOn(api, 'listAlerts').mockRejectedValue(new Error('offline'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset demo data' }));
    await waitFor(() => {
      expect(toastTitles()).toContain('Demo data reset, but reloading failed');
    });
  });

  it('clears notifications after confirmation and keeps focus in the card', async () => {
    act(() => {
      useNotificationStore
        .getState()
        .add({ id: 'a', kind: 'alert', title: 'A', body: '', at: 1, symbol: 'AAPL' });
      useNotificationStore
        .getState()
        .add({ id: 'b', kind: 'alert', title: 'B', body: '', at: 2, symbol: 'AAPL' });
    });
    const { user } = renderPage();
    const data = card('Data');
    expect(within(data).getByText('2 notifications are stored on this device.')).toBeInTheDocument();
    await user.click(within(data).getByRole('button', { name: 'Clear notifications…' }));
    const dialog = screen.getByRole('dialog', { name: 'Clear notifications?' });
    expect(dialog).toHaveAccessibleDescription(/All 2 notifications are removed/);
    await user.click(within(dialog).getByRole('button', { name: 'Clear notifications' }));
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(within(data).getByRole('button', { name: 'Clear notifications…' })).toBeDisabled();
    expect(within(data).getByText('No notifications are stored.')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(data).getByRole('button', { name: 'Reset demo data…' })).toHaveFocus();
    });
  });

  it('restores default settings', async () => {
    useSettingsStore.getState().update({ chartStyle: 'line', triggerToasts: false, defaultChartRange: '1Y' });
    const { user } = renderPage();
    await user.click(within(card('Data')).getByRole('button', { name: 'Restore defaults' }));
    expect(settings()).toEqual(DEFAULT_SETTINGS);
    expect(localStorage.getItem('aperture.theme')).toBe('system');
    expect(toastTitles()).toContain('Settings restored to defaults');
  });

  it('shows the version and that Aperture only monitors', () => {
    renderPage();
    const about = card('About');
    expect(within(about).getByText(/^\d+\.\d+\.\d+/)).toBeInTheDocument();
    expect(
      within(about).getByText(
        'Monitoring only — Aperture never places trades. Buy and Sell on alerts are labels.',
      ),
    ).toBeInTheDocument();
  });

  it('starts one reset even when confirm is pressed twice', async () => {
    updateSimulation({ apiLatencyMs: 30 });
    const { user } = renderPage();
    await user.click(within(card('Data')).getByRole('button', { name: 'Reset demo data…' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset demo data' });
    await user.click(confirm);
    // A second confirm while the first reset runs starts nothing new.
    await user.click(confirm);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(toastTitles().filter((t) => t === 'Demo data reset')).toHaveLength(1);
  });
});

describe('settings.css', () => {
  it('uses theme tokens only, so both themes work', () => {
    const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
    const css = fs.readFileSync(`${dirname}/settings.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
  });
});
