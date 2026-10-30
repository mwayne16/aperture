import {
  Bell,
  BellPlus,
  ChartLine,
  Copy,
  Download,
  Ellipsis,
  Funnel,
  Inbox,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Sun,
  Trash,
} from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';
import { Menu } from './Menu';
import { Panel } from './Panel';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { StatusDot } from './StatusDot';
import { Switch } from './Switch';
import { Tabs } from './Tabs';
import { TextInput } from './TextInput';
import { useTheme, type ThemePreference } from './theme';
import { showToast } from './toastStore';
import { Tooltip } from './Tooltip';
import './showcase.css';

/* ------------------------------------------------------------ simulated sample data */

interface SampleQuote {
  symbol: string;
  name: string;
  last: number;
  prevClose: number;
  spread: number;
  volume: number;
}

/** Simulated values for judging density. Not market data. */
const SAMPLE_QUOTES: readonly SampleQuote[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', last: 227.48, prevClose: 225.17, spread: 0.02, volume: 48_210_000 },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    last: 431.12,
    prevClose: 434.2,
    spread: 0.04,
    volume: 19_870_000,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    last: 138.27,
    prevClose: 133.35,
    spread: 0.01,
    volume: 312_400_000,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    last: 186.4,
    prevClose: 185.52,
    spread: 0.02,
    volume: 37_060_000,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc. A',
    last: 164.73,
    prevClose: 165.85,
    spread: 0.02,
    volume: 22_510_000,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms',
    last: 589.95,
    prevClose: 582.54,
    spread: 0.06,
    volume: 11_340_000,
  },
  { symbol: 'TSLA', name: 'Tesla Inc.', last: 218.85, prevClose: 228.22, spread: 0.03, volume: 96_770_000 },
  {
    symbol: 'BRK.B',
    name: 'Berkshire Hathaway B',
    last: 463.2,
    prevClose: 463.2,
    spread: 0.08,
    volume: 2_940_000,
  },
  { symbol: 'JPM', name: 'JPMorgan Chase', last: 222.14, prevClose: 223.1, spread: 0.02, volume: 8_120_000 },
  {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    last: 155.62,
    prevClose: 153.47,
    spread: 0.02,
    volume: 41_880_000,
  },
];

const FLASH_ROW = 2;
const FLASH_INTERVAL_MS = 1800;
const MINUS = '−';

const priceFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtPrice(value: number): string {
  return priceFormat.format(value);
}

function fmtSigned(value: number, suffix = ''): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return `0.00${suffix}`;
  return `${rounded > 0 ? '+' : MINUS}${priceFormat.format(Math.abs(rounded))}${suffix}`;
}

function fmtVolume(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

function direction(value: number): 'gain' | 'loss' | 'flat' {
  const rounded = Math.round(value * 100) / 100;
  if (rounded > 0) return 'gain';
  if (rounded < 0) return 'loss';
  return 'flat';
}

/* ------------------------------------------------------------ quote table */

function QuoteTable() {
  const [selected, setSelected] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
    }, FLASH_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setSelected((s) => Math.min(SAMPLE_QUOTES.length - 1, Math.max(0, s + (e.key === 'ArrowDown' ? 1 : -1))));
  };

  const flashUp = tick % 2 === 1;

  return (
    <table
      className="ui-table sc-quotes"
      role="grid"
      aria-label="Simulated quotes"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <thead>
        <tr>
          <th scope="col">Symbol</th>
          <th scope="col" className="is-num">
            Last
          </th>
          <th scope="col" className="is-num">
            Chg
          </th>
          <th scope="col" className="is-num">
            Chg%
          </th>
          <th scope="col" className="is-num">
            Bid
          </th>
          <th scope="col" className="is-num">
            Ask
          </th>
          <th scope="col" className="is-num">
            Volume
          </th>
        </tr>
      </thead>
      <tbody>
        {SAMPLE_QUOTES.map((q, index) => {
          const flashing = index === FLASH_ROW && tick > 0;
          const last = flashing && flashUp ? q.last + 0.04 : q.last;
          const change = last - q.prevClose;
          const pct = (change / q.prevClose) * 100;
          const dir = direction(change);
          const tone: BadgeTone = dir === 'gain' ? 'gain' : dir === 'loss' ? 'loss' : 'muted';
          const flashClass = flashing ? (flashUp ? 'flash-up' : 'flash-down') : undefined;
          const cellKey = flashing ? `-${tick}` : '';
          return (
            <tr
              key={q.symbol}
              aria-selected={index === selected}
              onClick={() => {
                setSelected(index);
              }}
            >
              <td>
                <span className="sc-symbol">{q.symbol}</span>
                <span className="sc-name">{q.name}</span>
              </td>
              <td key={`last${cellKey}`} className={`is-num sc-last ${flashClass ?? ''}`}>
                {fmtPrice(last)}
              </td>
              <td className={`is-num ${dir === 'flat' ? 'is-muted' : `is-${dir}`}`}>{fmtSigned(change)}</td>
              <td className="is-num">
                <Badge tone={tone} size="sm">
                  {fmtSigned(pct, '%')}
                </Badge>
              </td>
              <td key={`bid${cellKey}`} className={`is-num ${flashClass ?? ''}`}>
                {fmtPrice(last - q.spread / 2)}
              </td>
              <td key={`ask${cellKey}`} className={`is-num ${flashClass ?? ''}`}>
                {fmtPrice(last + q.spread / 2)}
              </td>
              <td className="is-num is-muted">{fmtVolume(q.volume)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------ sections */

function IconLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <>
      <span aria-hidden="true" className="sc-icon-label">
        {icon}
      </span>
      <span className="visually-hidden">{text}</span>
    </>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: ReactNode; title: string }[] = [
  { value: 'system', label: <IconLabel icon={<Monitor />} text="System" />, title: 'Follow system' },
  { value: 'dark', label: <IconLabel icon={<Moon />} text="Dark" />, title: 'Dark' },
  { value: 'light', label: <IconLabel icon={<Sun />} text="Light" />, title: 'Light' },
];

function ThemeSwitcher() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div className="sc-theme">
      <span className="sc-theme__label">Theme</span>
      <SegmentedControl
        options={THEME_OPTIONS}
        value={preference}
        onChange={setPreference}
        aria-label="Theme"
      />
      <span className="sc-theme__resolved">
        {preference === 'system' ? `System (${resolved})` : resolved === 'dark' ? 'Dark' : 'Light'}
      </span>
    </div>
  );
}

const COLOR_TOKENS = [
  ['--bg-app', '--bg-chrome', '--bg-panel', '--bg-raised', '--bg-input', '--bg-hover', '--bg-selected'],
  ['--border-subtle', '--border', '--border-strong', '--text-primary', '--text-muted', '--text-faint'],
  [
    '--accent',
    '--accent-hover',
    '--gain',
    '--loss',
    '--warning',
    '--gain-tint',
    '--loss-tint',
    '--warning-tint',
  ],
] as const;

function TokenSwatches() {
  return (
    <div className="sc-swatches">
      {COLOR_TOKENS.map((group) => (
        <ul key={group[0]} className="sc-swatches__group">
          {group.map((token) => (
            <li key={token} className="sc-swatch">
              <span className="sc-swatch__chip" style={{ background: `var(${token})` }} />
              <code className="sc-swatch__name">{token}</code>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sc-row">
      <span className="sc-row__label">{label}</span>
      <div className="sc-row__items">{children}</div>
    </div>
  );
}

function ButtonsSection() {
  return (
    <div className="sc-stack">
      <Row label="Variants">
        <Button variant="primary" icon={<Plus />}>
          Add symbol
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger" icon={<Trash />}>
          Delete
        </Button>
      </Row>
      <Row label="Disabled">
        <Button variant="primary" disabled>
          Primary
        </Button>
        <Button variant="secondary" disabled>
          Secondary
        </Button>
        <Button variant="ghost" disabled>
          Ghost
        </Button>
        <Button variant="danger" disabled>
          Danger
        </Button>
      </Row>
      <Row label="Loading">
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button variant="secondary" loading>
          Refreshing
        </Button>
        <Button variant="danger" loading>
          Deleting
        </Button>
      </Row>
      <Row label="Small">
        <Button variant="primary" size="sm" icon={<BellPlus />}>
          Alert
        </Button>
        <Button variant="secondary" size="sm" icon={<Funnel />}>
          Filter
        </Button>
        <Button variant="ghost" size="sm">
          Reset
        </Button>
        <Button variant="secondary" size="sm" disabled>
          Disabled
        </Button>
      </Row>
      <Row label="Icon">
        <IconButton label="Refresh" icon={<RefreshCw />} />
        <IconButton label="Watch" icon={<Star />} active />
        <IconButton label="Settings" icon={<Settings />} variant="secondary" />
        <IconButton label="Edit" icon={<Pencil />} disabled />
        <IconButton label="Notifications" icon={<Bell />} size="sm" />
        <IconButton label="Chart" icon={<ChartLine />} size="sm" variant="secondary" active />
      </Row>
    </div>
  );
}

const ALERT_FIELD_OPTIONS = [
  { value: 'last', label: 'Last trade price' },
  { value: 'bid', label: 'Bid' },
  { value: 'ask', label: 'Ask' },
  { value: 'mid', label: 'Mid (unsupported)', disabled: true },
];

function FieldsSection() {
  const [symbol, setSymbol] = useState('');
  return (
    <div className="sc-fields">
      <TextInput
        label="Symbol"
        placeholder="Search symbols"
        leadingIcon={<Search />}
        value={symbol}
        onChange={(e) => {
          setSymbol(e.target.value.toUpperCase());
        }}
        hint="Ticker or company name"
      />
      <TextInput
        label="Target price"
        defaultValue="-12"
        inputMode="decimal"
        error="Price must be greater than 0"
      />
      <TextInput label="Note" placeholder="Optional" />
      <TextInput label="Disabled" defaultValue="NASDAQ" disabled />
      <Select label="Alert field" options={ALERT_FIELD_OPTIONS} defaultValue="last" />
      <Select label="Condition" options={[{ value: '', label: 'Choose…' }]} error="Choose a condition" />
      <Select label="Disabled" options={[{ value: 'iex', label: 'Alpaca IEX' }]} disabled />
    </div>
  );
}

const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '5Y'] as const;
type Range = (typeof RANGES)[number];
type ChartStyle = 'candles' | 'line' | 'area';
type DetailTab = 'overview' | 'alerts' | 'notes';

function SelectionSection() {
  const [range, setRange] = useState<Range>('1M');
  const [style, setStyle] = useState<ChartStyle>('candles');
  const [tab, setTab] = useState<DetailTab>('overview');
  const [extended, setExtended] = useState(true);
  const [sound, setSound] = useState(false);
  return (
    <div className="sc-stack">
      <Row label="Segmented">
        <SegmentedControl
          options={RANGES.map((r) => ({ value: r, label: r }))}
          value={range}
          onChange={setRange}
          size="sm"
          aria-label="Chart range"
        />
      </Row>
      <Row label="Medium">
        <SegmentedControl<ChartStyle>
          options={[
            { value: 'candles', label: 'Candles' },
            { value: 'line', label: 'Line' },
            { value: 'area', label: 'Area' },
          ]}
          value={style}
          onChange={setStyle}
          aria-label="Chart style"
        />
        <SegmentedControl
          options={[
            { value: 'a', label: 'On' },
            { value: 'b', label: 'Off' },
          ]}
          value="a"
          onChange={() => undefined}
          aria-label="Disabled example"
          disabled
        />
      </Row>
      <Tabs<DetailTab>
        aria-label="Detail sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'alerts', label: 'Alerts', badge: 3 },
          { value: 'notes', label: 'Notes', badge: 12 },
        ]}
      />
      <Row label="Switch">
        <Switch checked={extended} onChange={setExtended} label="Extended hours" />
        <Switch checked={sound} onChange={setSound} label="Alert sound" />
        <Switch checked onChange={() => undefined} label="Disabled" disabled />
        <Switch checked={sound} onChange={setSound} label="Compact" hideLabel />
      </Row>
    </div>
  );
}

const BADGE_TONES: BadgeTone[] = ['neutral', 'accent', 'gain', 'loss', 'warning', 'muted'];

function BadgesSection() {
  return (
    <div className="sc-stack">
      {(['soft', 'solid', 'outline'] as const).map((variant) => (
        <Row key={variant} label={variant}>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone} variant={variant}>
              {tone}
            </Badge>
          ))}
        </Row>
      ))}
      <Row label="Small">
        <Badge tone="warning" size="sm">
          SIMULATED
        </Badge>
        <Badge tone="gain" size="sm">
          +1.03%
        </Badge>
        <Badge tone="loss" size="sm">
          {MINUS}4.11%
        </Badge>
        <Badge tone="muted" size="sm" variant="outline" title="Delayed 15 minutes">
          DELAYED
        </Badge>
      </Row>
      <Row label="Status">
        <StatusDot tone="gain" pulse label="Live" />
        <StatusDot tone="warning" label="Delayed" />
        <StatusDot tone="muted" label="Stale" />
        <StatusDot tone="loss" label="Disconnected" />
        <StatusDot tone="accent" pulse label="Connecting" />
      </Row>
    </div>
  );
}

function OverlaysSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteListOpen, setDeleteListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Tech leaders');

  useEffect(() => {
    if (!busy) return;
    const id = window.setTimeout(() => {
      setBusy(false);
      setConfirmOpen(false);
      showToast({ tone: 'success', title: 'Alert deleted', description: 'NVDA above 140.00 was removed.' });
    }, 1200);
    return () => {
      window.clearTimeout(id);
    };
  }, [busy]);

  return (
    <div className="sc-stack">
      <Row label="Dialogs">
        <Button
          icon={<Pencil />}
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          Rename watchlist
        </Button>
        <Button
          variant="danger"
          icon={<Trash />}
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          Delete alert
        </Button>
      </Row>
      <Row label="Menu">
        <Menu
          align="start"
          trigger={(props) => (
            <Button {...props} icon={<Ellipsis />}>
              Actions
            </Button>
          )}
          items={[
            {
              id: 'watch',
              label: 'Add to watchlist',
              icon: <Plus />,
              onSelect: () => showToast({ tone: 'info', title: 'Added to watchlist' }),
            },
            {
              id: 'alert',
              label: 'Create alert…',
              icon: <BellPlus />,
              onSelect: () => showToast({ tone: 'info', title: 'Create alert' }),
            },
            {
              id: 'copy',
              label: 'Copy symbol',
              icon: <Copy />,
              onSelect: () => showToast({ tone: 'info', title: 'Copied NVDA' }),
            },
            {
              id: 'export',
              label: 'Export CSV',
              icon: <Download />,
              onSelect: () => undefined,
              disabled: true,
            },
            {
              id: 'remove',
              label: 'Remove from list',
              icon: <Trash />,
              onSelect: () => showToast({ tone: 'warning', title: 'Removed NVDA' }),
              danger: true,
            },
          ]}
        />
        <Menu
          align="end"
          trigger={(props) => (
            <IconButton {...props} label="More actions" icon={<Ellipsis />} variant="secondary" />
          )}
          items={[
            { id: 'refresh', label: 'Refresh', icon: <RefreshCw />, onSelect: () => undefined },
            { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: () => undefined },
          ]}
        />
      </Row>
      <Row label="Tooltip">
        <Tooltip
          content={
            <>
              Refresh quotes <Kbd>R</Kbd>
            </>
          }
        >
          <Button variant="secondary" icon={<RefreshCw />}>
            Hover or focus me
          </Button>
        </Tooltip>
        <Tooltip content="Opens below" side="bottom">
          <Button variant="ghost">Bottom</Button>
        </Tooltip>
      </Row>
      <Row label="Toasts">
        <Button
          size="sm"
          onClick={() =>
            showToast({
              tone: 'info',
              title: 'Feed reconnected',
              description: 'Simulated feed is streaming again.',
            })
          }
        >
          Info
        </Button>
        <Button
          size="sm"
          onClick={() =>
            showToast({
              tone: 'success',
              title: 'Alert created',
              description: 'AAPL crosses above 230.00 (last trade).',
            })
          }
        >
          Success
        </Button>
        <Button
          size="sm"
          onClick={() =>
            showToast({ tone: 'warning', title: 'Data is stale', description: 'No update for TSLA in 30s.' })
          }
        >
          Warning
        </Button>
        <Button
          size="sm"
          onClick={() =>
            showToast({
              tone: 'error',
              title: 'Connection lost',
              description: 'Retrying in 5s.',
              durationMs: 8000,
            })
          }
        >
          Error
        </Button>
      </Row>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        title="Rename watchlist"
        description="Names are shown in the sidebar and in alert notifications."
        footer={
          <>
            <Button
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={name.trim() === ''}
              onClick={() => {
                setDialogOpen(false);
                showToast({ tone: 'success', title: `Renamed to “${name.trim()}”` });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="sc-dialog-fields">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            error={name.trim() === '' ? 'Name is required' : undefined}
          />
          <Select
            label="Sort by"
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'chg', label: 'Change %' },
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash />}
            className="sc-dialog-fields__action"
            onClick={() => {
              setDeleteListOpen(true);
            }}
          >
            Delete watchlist…
          </Button>
        </div>
        {/* A confirmation opened from inside another dialog. */}
        <ConfirmDialog
          open={deleteListOpen}
          title="Delete watchlist?"
          message="Its symbols and their alerts are removed. This can’t be undone."
          confirmLabel="Delete watchlist"
          tone="danger"
          onConfirm={() => {
            setDeleteListOpen(false);
            setDialogOpen(false);
            showToast({ tone: 'warning', title: 'Watchlist deleted' });
          }}
          onCancel={() => {
            setDeleteListOpen(false);
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete alert?"
        message={
          <>
            <strong>NVDA above 140.00</strong> (last trade) will stop evaluating. This can’t be undone.
          </>
        }
        confirmLabel="Delete alert"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
        }}
        onCancel={() => {
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function FeedbackSection() {
  return (
    <div className="sc-feedback">
      <div className="sc-feedback__empty">
        <EmptyState
          icon={<Inbox />}
          title="No alerts yet"
          description="Create an alert to get notified when a symbol crosses a price."
          action={
            <Button variant="primary" size="sm" icon={<BellPlus />}>
              Create alert
            </Button>
          }
        />
      </div>
      <div className="sc-feedback__side">
        <EmptyState compact icon={<Search />} title="No matches" description="Try a ticker like AAPL." />
        <div className="sc-skeletons" aria-label="Loading example">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sc-skeletons__row">
              <Skeleton width={44} height={10} />
              <Skeleton width="40%" height={10} />
              <Skeleton width={56} height={10} />
            </div>
          ))}
        </div>
        <div className="sc-row__items">
          <Spinner />
          <Spinner size={18} label="Loading chart" />
          <span className="sc-kbds">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
            <span className="sc-muted">search</span>
            <Kbd>Esc</Kbd>
            <span className="sc-muted">close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function TypeSection() {
  return (
    <div className="sc-type">
      <p className="sc-type__2xl num">227.48</p>
      <p className="sc-type__xl">Apple Inc.</p>
      <p className="sc-type__lg">Section heading 15</p>
      <p className="sc-type__md">Body 13 — the base size for tables and controls.</p>
      <p className="sc-type__sm">Secondary 12 — labels and metadata.</p>
      <p className="sc-type__xs">CAPTION 11 — COLUMN HEADERS</p>
      <p className="sc-type__mono">mono 0123456789 +1.23 {MINUS}4.56</p>
    </div>
  );
}

/* ------------------------------------------------------------ page */

/** Every primitive in its states, plus a dense quote table, for design review. Simulated data only. */
export function Showcase() {
  return (
    <div className="sc">
      <div className="sc-toolbar">
        <ThemeSwitcher />
        <span className="sc-toolbar__note">
          Design system review. All prices on this page are <strong>simulated</strong>.
        </span>
      </div>
      <div className="sc-grid">
        <Panel
          className="sc-wide"
          title={
            <>
              <span>Quotes</span>
              <Badge tone="warning" size="sm" title="Simulated values, not market data">
                SIMULATED
              </Badge>
            </>
          }
          actions={
            <>
              <IconButton label="Filter" icon={<Funnel />} size="sm" />
              <IconButton label="Refresh" icon={<RefreshCw />} size="sm" />
              <IconButton label="Panel settings" icon={<Settings />} size="sm" />
            </>
          }
        >
          <QuoteTable />
        </Panel>
        <Panel title="Buttons" bodyClassName="sc-body">
          <ButtonsSection />
        </Panel>
        <Panel title="Fields" bodyClassName="sc-body">
          <FieldsSection />
        </Panel>
        <Panel title="Selection" bodyClassName="sc-body">
          <SelectionSection />
        </Panel>
        <Panel title="Badges and status" bodyClassName="sc-body">
          <BadgesSection />
        </Panel>
        <Panel title="Overlays" bodyClassName="sc-body">
          <OverlaysSection />
        </Panel>
        <Panel title="Feedback" bodyClassName="sc-body">
          <FeedbackSection />
        </Panel>
        <Panel title="Color tokens" bodyClassName="sc-body">
          <TokenSwatches />
        </Panel>
        <Panel title="Type scale" bodyClassName="sc-body">
          <TypeSection />
        </Panel>
      </div>
    </div>
  );
}
