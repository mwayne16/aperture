import { RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { version } from '../../../package.json';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { SegmentedControl, type SegmentedOption } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { StatusDot } from '../../components/ui/StatusDot';
import { Switch } from '../../components/ui/Switch';
import { useTheme, type ThemePreference } from '../../components/ui/theme';
import { showToast } from '../../components/ui/toastStore';
import { useConnection } from '../../data/connectionStore';
import { CHART_RANGES, type ChartRange } from '../../domain/types';
import { useNotificationStore } from '../notifications/notificationStore';
import { describeConnection } from '../shell/connectionStatus';
import { resetDemoAndReload } from '../shell/resetDemo';
import { useFeedStatus } from '../shell/useFeedStatus';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { isChartRange, type Settings } from './settingsRules';
import { useSettingsStore } from './settingsStore';
import './settings.css';

const THEME_OPTIONS: SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const CHART_STYLE_OPTIONS: SegmentedOption<Settings['chartStyle']>[] = [
  { value: 'candles', label: 'Candles' },
  { value: 'line', label: 'Line' },
];

const RANGE_LABELS: Record<ChartRange, string> = {
  '1D': '1 day',
  '1W': '1 week',
  '1M': '1 month',
  '3M': '3 months',
  '6M': '6 months',
  YTD: 'Year to date',
  '1Y': '1 year',
  '5Y': '5 years',
  '10Y': '10 years',
  ALL: 'All history',
};

const RANGE_OPTIONS = CHART_RANGES.map((range) => ({ value: range, label: RANGE_LABELS[range] }));

const updateSettings = (patch: Partial<Settings>) => {
  useSettingsStore.getState().update(patch);
};

/** App preferences in cards: appearance, market data, notifications, charts, demo data and about. */
export function SettingsPage() {
  return (
    <div className="page settings-page">
      <PageHeader title="Settings" description="Preferences are saved on this device." />
      <div className="settings-grid">
        <AppearanceSection />
        <NotificationSection />
        <MarketDataSection />
        <ChartSection />
        <DataSection />
        <AboutSection />
      </div>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className="settings-card" aria-labelledby={headingId}>
      <div className="settings-card__header">
        <h2 id={headingId} className="settings-card__title">
          {title}
        </h2>
        {description !== undefined && <p className="settings-card__description">{description}</p>}
      </div>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  /** Id of the hint, for the control's aria-describedby. */
  hintId: string;
  hint: ReactNode;
  children: ReactNode;
}

/** A label and hint on the left, the control on the right. The control names itself. */
function SettingRow({ label, hintId, hint, children }: SettingRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <p className="settings-row__label" aria-hidden="true">
          {label}
        </p>
        <p id={hintId} className="settings-row__hint">
          {hint}
        </p>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function AppearanceSection() {
  const { preference, resolved, setPreference } = useTheme();
  const hintId = useId();
  return (
    <SettingsCard title="Appearance">
      <SettingRow
        label="Theme"
        hintId={hintId}
        hint={preference === 'system' ? `Follows your operating system (currently ${resolved}).` : 'Used on every page.'}
      >
        <SegmentedControl<ThemePreference>
          aria-label="Theme"
          aria-describedby={hintId}
          options={THEME_OPTIONS}
          value={preference}
          onChange={setPreference}
        />
      </SettingRow>
    </SettingsCard>
  );
}

function NotificationSection() {
  const triggerToasts = useSettingsStore((s) => s.settings.triggerToasts);
  const toastHintId = useId();
  const desktopHintId = useId();
  return (
    <SettingsCard title="Notifications">
      <SettingRow
        label="Trigger toasts"
        hintId={toastHintId}
        hint="Show a pop-up when an alert triggers. Every trigger is still recorded in Notifications."
      >
        <Switch
          label="Trigger toasts"
          hideLabel
          checked={triggerToasts}
          aria-describedby={toastHintId}
          onChange={(checked) => {
            updateSettings({ triggerToasts: checked });
          }}
        />
      </SettingRow>
      <SettingRow label="Desktop notifications" hintId={desktopHintId} hint="Available in the desktop app.">
        <Switch
          label="Desktop notifications"
          hideLabel
          checked={false}
          disabled
          aria-describedby={desktopHintId}
          onChange={() => undefined}
        />
      </SettingRow>
    </SettingsCard>
  );
}

function MarketDataSection() {
  const connection = useConnection();
  const { freshness } = useFeedStatus();
  const view = describeConnection(connection, freshness);
  return (
    <SettingsCard title="Market data" description="Where prices come from.">
      <div className="settings-source">
        <div className="settings-source__heading">
          <p className="settings-source__name">Current source</p>
          <p className="settings-source__value">{connection.feedName}</p>
          {connection.simulated && (
            <SimulatedBadge title="Prices are generated in the app, not taken from a real market" />
          )}
          <span className="settings-source__status">
            <StatusDot tone={view.tone} label={view.dataNote ? `${view.label} · ${view.dataNote.label}` : view.label} />
          </span>
        </div>
        <p className="settings-source__text">
          This prototype generates prices on your device to show how Aperture behaves. They are not real market data.
        </p>
      </div>
      <div className="settings-source">
        <div className="settings-source__heading">
          <p className="settings-source__name">Planned source</p>
          <p className="settings-source__value">Alpaca — IEX (free)</p>
          <Badge tone="accent" size="sm">
            Planned
          </Badge>
        </div>
        <ul className="settings-source__list">
          <li>Real-time trades and quotes, from the IEX exchange only rather than every US exchange.</li>
          <li>Volume counts IEX trades only, so it reads far lower than total market volume.</li>
          <li>No fundamentals such as earnings, ratios or company financials.</li>
          <li>API keys are configured in the backend later, not in this app.</li>
        </ul>
      </div>
    </SettingsCard>
  );
}

function ChartSection() {
  const defaultChartRange = useSettingsStore((s) => s.settings.defaultChartRange);
  const chartStyle = useSettingsStore((s) => s.settings.chartStyle);
  const rangeHintId = useId();
  const styleHintId = useId();
  return (
    <SettingsCard title="Charts">
      <SettingRow label="Default range" hintId={rangeHintId} hint="The range a stock chart opens with.">
        <Select
          aria-label="Default range"
          aria-describedby={rangeHintId}
          className="settings-row__select"
          options={RANGE_OPTIONS}
          value={defaultChartRange}
          onChange={(event) => {
            const range = event.currentTarget.value;
            if (isChartRange(range)) updateSettings({ defaultChartRange: range });
          }}
        />
      </SettingRow>
      <SettingRow label="Chart style" hintId={styleHintId} hint="Candles show open, high, low and close; line shows closes.">
        <SegmentedControl<Settings['chartStyle']>
          aria-label="Chart style"
          aria-describedby={styleHintId}
          options={CHART_STYLE_OPTIONS}
          value={chartStyle}
          onChange={(value) => {
            updateSettings({ chartStyle: value });
          }}
        />
      </SettingRow>
    </SettingsCard>
  );
}

function DataSection() {
  const notificationCount = useNotificationStore((s) => s.notifications.length);
  const { setPreference } = useTheme();
  const [confirming, setConfirming] = useState<'reset' | 'clear' | null>(null);
  const [resetting, setResetting] = useState(false);
  // ** A ref, not state, so a second confirm in the same frame can't start another reset.
  const resetInFlight = useRef(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterClear = useRef(false);
  const resetHintId = useId();
  const clearHintId = useId();
  const defaultsHintId = useId();

  // ** Clearing disables the button that opened the confirmation, so focus moves to the row above.
  useEffect(() => {
    if (focusAfterClear.current && notificationCount === 0) {
      focusAfterClear.current = false;
      resetButtonRef.current?.focus();
    }
  }, [notificationCount]);

  const reset = async () => {
    if (resetInFlight.current) return;
    resetInFlight.current = true;
    setResetting(true);
    const outcome = await resetDemoAndReload();
    resetInFlight.current = false;
    setResetting(false);
    setConfirming(null);
    if (outcome.ok) {
      showToast({
        tone: 'success',
        title: 'Demo data reset',
        description: 'Your watchlist and alerts are back to the seeded demo set.',
      });
    } else {
      showToast({
        tone: outcome.dataReset ? 'warning' : 'error',
        title: outcome.dataReset ? 'Demo data reset, but reloading failed' : 'Demo data was not reset',
        description: outcome.message,
      });
    }
  };

  return (
    <SettingsCard title="Data">
      <SettingRow
        label="Demo data"
        hintId={resetHintId}
        hint="Restores the seeded watchlist and alerts. Settings and notifications are kept."
      >
        <Button
          ref={resetButtonRef}
          icon={<RotateCcw />}
          aria-haspopup="dialog"
          aria-describedby={resetHintId}
          onClick={() => {
            setConfirming('reset');
          }}
        >
          Reset demo data…
        </Button>
      </SettingRow>
      <SettingRow
        label="Notifications"
        hintId={clearHintId}
        hint={
          notificationCount === 0
            ? 'No notifications are stored.'
            : `${notificationCount} ${notificationCount === 1 ? 'notification is' : 'notifications are'} stored on this device.`
        }
      >
        <Button
          icon={<Trash2 />}
          aria-haspopup="dialog"
          aria-describedby={clearHintId}
          disabled={notificationCount === 0}
          onClick={() => {
            setConfirming('clear');
          }}
        >
          Clear notifications…
        </Button>
      </SettingRow>
      <SettingRow
        label="Preferences"
        hintId={defaultsHintId}
        hint="Puts the theme, notification and chart settings back to their defaults."
      >
        <Button
          aria-describedby={defaultsHintId}
          onClick={() => {
            useSettingsStore.getState().reset();
            setPreference('system');
            showToast({ tone: 'success', title: 'Settings restored to defaults' });
          }}
        >
          Restore defaults
        </Button>
      </SettingRow>
      <ConfirmDialog
        open={confirming === 'reset'}
        title="Reset demo data?"
        message="Your watchlist and alerts return to the seeded demo set. Anything you created or changed is lost."
        confirmLabel="Reset demo data"
        tone="danger"
        busy={resetting}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          void reset();
        }}
      />
      <ConfirmDialog
        open={confirming === 'clear'}
        title="Clear notifications?"
        message={`All ${notificationCount} notifications are removed from this device. This can't be undone.`}
        confirmLabel="Clear notifications"
        tone="danger"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          focusAfterClear.current = true;
          setConfirming(null);
          useNotificationStore.getState().clear();
        }}
      />
    </SettingsCard>
  );
}

function AboutSection() {
  return (
    <SettingsCard title="About">
      <dl className="settings-about">
        <div>
          <dt>Version</dt>
          <dd className="num">{version}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>Interactive prototype with simulated market data</dd>
        </div>
      </dl>
      <p className="settings-about__note">
        Monitoring only — Aperture never places trades. Buy and Sell on alerts are labels.
      </p>
    </SettingsCard>
  );
}
