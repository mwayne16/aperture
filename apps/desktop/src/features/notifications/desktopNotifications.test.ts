import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopNotification, NotificationClick } from '../../../electron/bridge';
import { DEFAULT_SETTINGS } from '../settings/settingsRules';
import { useSettingsStore } from '../settings/settingsStore';
import { listenForNotificationClicks, showDesktopNotification } from './desktopNotifications';
import { useNotificationStore } from './notificationStore';

let shown: DesktopNotification[];
let clickListeners: ((click: NotificationClick) => void)[];

const TRIGGER = {
  id: 'alert:evt_1',
  kind: 'alert' as const,
  title: 'AAPL above 200.00 · Buy',
  body: 'Last trade 201.00 at 10:01 ET',
  at: 1,
  symbol: 'AAPL',
};

beforeEach(() => {
  shown = [];
  clickListeners = [];
  window.aperture = {
    platform: 'win32',
    versions: { electron: '45.0.0', chrome: '146.0.0' },
    notify: (notification) => shown.push(notification),
    onNotificationClick: (listener) => {
      clickListeners.push(listener);
      return () => {
        clickListeners = clickListeners.filter((l) => l !== listener);
      };
    },
  };
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
  useNotificationStore.setState({ notifications: [] });
  window.location.hash = '#/alerts';
});

afterEach(() => {
  delete window.aperture;
  vi.restoreAllMocks();
});

describe('showDesktopNotification', () => {
  it('asks the desktop app to show the trigger, with its inbox id and stock', () => {
    showDesktopNotification(TRIGGER, false);
    expect(shown).toEqual([
      {
        id: 'alert:evt_1',
        title: 'AAPL above 200.00 · Buy',
        body: 'Last trade 201.00 at 10:01 ET',
        symbol: 'AAPL',
      },
    ]);
  });

  it('says a simulated trigger is simulated, in the title', () => {
    showDesktopNotification(TRIGGER, true);
    expect(shown[0]?.title).toBe('Simulated · AAPL above 200.00 · Buy');
  });

  it('shows nothing when desktop notifications are off, or outside the desktop app', () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, desktopNotifications: false } });
    showDesktopNotification(TRIGGER, false);
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    const bridge = window.aperture;
    delete window.aperture;
    showDesktopNotification(TRIGGER, false);
    window.aperture = bridge;
    expect(shown).toEqual([]);
  });
});

describe('listenForNotificationClicks', () => {
  it('opens the clicked stock page and marks its inbox entry read', () => {
    useNotificationStore.getState().add(TRIGGER);
    const stop = listenForNotificationClicks();
    clickListeners[0]?.({ id: 'alert:evt_1', symbol: 'BTC/USD' });
    expect(window.location.hash).toBe('#/symbol/BTC%2FUSD');
    expect(useNotificationStore.getState().notifications[0]?.read).toBe(true);
    stop();
    expect(clickListeners).toEqual([]);
  });

  it('stays on the page for a click without a stock', () => {
    listenForNotificationClicks();
    clickListeners[0]?.({ id: 'connection:1', symbol: null });
    expect(window.location.hash).toBe('#/alerts');
  });

  it('does nothing outside the desktop app', () => {
    delete window.aperture;
    expect(() => {
      listenForNotificationClicks()();
    }).not.toThrow();
  });
});
