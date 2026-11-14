/*
 * QA for the selection controls and theme as a user drives them, under <StrictMode>: Tabs and
 * SegmentedControl with keyboard and mouse mixed in one session, the controls inside a dialog,
 * a hover tooltip inside a dialog, and a theme switch re-theming the tokens a chart canvas reads.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';
import { Tabs } from './Tabs';
import { readThemeColors, useTheme, type ThemePreference } from './theme';

type DetailTab = 'quotes' | 'chart' | 'news' | 'alerts';

const DETAIL_TABS = [
  { value: 'quotes' as const, label: 'Quotes' },
  { value: 'chart' as const, label: 'Chart' },
  { value: 'news' as const, label: 'News' },
  { value: 'alerts' as const, label: 'Alerts', badge: 3 },
];

/** A detail pane: tabs, a panel, and a button elsewhere on the page that switches tabs. */
function DetailPane({
  onChange,
  initial = 'quotes',
}: {
  onChange: (tab: DetailTab) => void;
  initial?: DetailTab;
}) {
  const [tab, setTab] = useState<DetailTab>(initial);
  return (
    <>
      <Button>Before tabs</Button>
      <Tabs<DetailTab>
        aria-label="Symbol detail"
        value={tab}
        onChange={(next) => {
          onChange(next);
          setTab(next);
        }}
        tabs={DETAIL_TABS}
      />
      <div role="tabpanel" aria-label={tab}>
        <Button>Panel action</Button>
      </div>
      <Button
        onClick={() => {
          setTab('alerts');
        }}
      >
        Show alerts
      </Button>
    </>
  );
}

type Range = '1D' | '5D' | '1M' | '1Y';

function RangePicker({ onChange }: { onChange: (range: Range) => void }) {
  const [range, setRange] = useState<Range>('1D');
  return (
    <SegmentedControl<Range>
      aria-label="Chart range"
      value={range}
      onChange={(next) => {
        onChange(next);
        setRange(next);
      }}
      options={[
        { value: '1D', label: '1D' },
        { value: '5D', label: '5D', title: '5 days' },
        { value: '1M', label: '1M', title: '1 month' },
        { value: '1Y', label: '1Y' },
      ]}
    />
  );
}

function tab(name: string | RegExp) {
  return screen.getByRole('tab', { name });
}

describe('Tabs with keyboard and mouse mixed (QA)', () => {
  it('reports exactly one change per click or key, never for the selected tab, and keeps focus on the selection', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DetailPane onChange={onChange} />
      </StrictMode>,
    );

    await user.click(tab('Chart'));
    expect(tab('Chart')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('News')).toHaveAttribute('aria-selected', 'true');
    expect(tab('News')).toHaveFocus();
    await user.click(tab(/^Alerts/));
    await user.keyboard('{Home}');
    await user.keyboard('{End}');
    await user.keyboard('{ArrowRight}');
    expect(tab('Quotes')).toHaveFocus();
    expect(tab('Quotes')).toHaveAttribute('aria-selected', 'true');

    // Re-activating the selected tab is not a change.
    await user.click(tab('Quotes'));
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onChange.mock.calls).toEqual([
      ['chart'],
      ['news'],
      ['alerts'],
      ['quotes'],
      ['alerts'],
      ['quotes'],
    ]);
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
  });

  it('Tab enters on the selected tab, even after the page switched tabs, and focus moves alone never select', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DetailPane onChange={onChange} initial="news" />
      </StrictMode>,
    );

    await user.click(screen.getByRole('button', { name: 'Before tabs' }));
    await user.tab();
    expect(tab('News')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(tab('Chart')).toHaveAttribute('aria-selected', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Panel action' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(tab('Chart')).toHaveFocus();
    expect(onChange.mock.calls).toEqual([['chart']]);

    // Another control switches the tab; keyboard entry follows the new selection.
    await user.click(screen.getByRole('button', { name: 'Show alerts' }));
    expect(tab(/^Alerts/)).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Before tabs' }));
    await user.tab();
    expect(tab(/^Alerts/)).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('News')).toHaveAttribute('aria-selected', 'true');
    expect(onChange.mock.calls).toEqual([['chart'], ['news']]);
  });
});

describe('SegmentedControl with keyboard and mouse mixed (QA)', () => {
  it('titled (tooltip-wrapped) and plain options each report one change per action', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <RangePicker onChange={onChange} />
      </StrictMode>,
    );
    const radio = (name: string) => screen.getByRole('radio', { name });

    await user.click(radio('5D'));
    expect(radio('5D')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowDown}');
    expect(radio('1Y')).toBeChecked();

    // Re-pressing the checked option keeps it.
    await user.click(radio('1Y'));
    await user.keyboard(' ');
    expect(radio('1Y')).toBeChecked();

    await user.keyboard('{Home}');
    await user.keyboard('{ArrowUp}');
    await user.click(radio('1M'));

    expect(onChange.mock.calls).toEqual([['5D'], ['1M'], ['1Y'], ['1D'], ['1Y'], ['1M']]);
    expect(radio('1M')).toBeChecked();
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });
});

describe('selection controls inside a dialog (QA)', () => {
  function PreferencesDialog({
    onClose,
    onTab,
    onDensity,
    onSound,
  }: {
    onClose: () => void;
    onTab: (tab: DetailTab) => void;
    onDensity: (density: string) => void;
    onSound: (on: boolean) => void;
  }) {
    const [open, setOpen] = useState(false);
    const [detailTab, setDetailTab] = useState<DetailTab>('quotes');
    const [density, setDensity] = useState('comfortable');
    const [sound, setSound] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Preferences
        </Button>
        <Dialog
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          title="Preferences"
        >
          <Tabs<DetailTab>
            aria-label="Default detail tab"
            value={detailTab}
            onChange={(next) => {
              onTab(next);
              setDetailTab(next);
            }}
            tabs={DETAIL_TABS}
          />
          <SegmentedControl
            aria-label="Row density"
            value={density}
            onChange={(next) => {
              onDensity(next);
              setDensity(next);
            }}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <Switch
            label="Alert sound"
            checked={sound}
            onChange={(next) => {
              onSound(next);
              setSound(next);
            }}
          />
        </Dialog>
      </>
    );
  }

  it('arrows, Space and Enter drive tabs, segments and a switch without closing the dialog; one Escape closes it', async () => {
    const onClose = vi.fn();
    const onTab = vi.fn();
    const onDensity = vi.fn();
    const onSound = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <PreferencesDialog onClose={onClose} onTab={onTab} onDensity={onDensity} onSound={onSound} />
      </StrictMode>,
    );
    const opener = screen.getByRole('button', { name: 'Preferences' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Preferences' });

    // The first tab stop in the body is the tab strip, which hands focus to its selected tab.
    expect(within(dialog).getByRole('tab', { name: 'Quotes' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(within(dialog).getByRole('tab', { name: 'Chart' })).toHaveFocus();

    await user.tab();
    expect(within(dialog).getByRole('radio', { name: 'Comfortable' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    await user.tab();
    const toggle = within(dialog).getByRole('switch', { name: 'Alert sound' });
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
    await user.keyboard('{Enter}');
    expect(toggle).not.toBeChecked();

    expect(onTab.mock.calls).toEqual([['chart']]);
    expect(onDensity.mock.calls).toEqual([['compact']]);
    expect(onSound.mock.calls).toEqual([[true], [false]]);
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('a hover tooltip inside a dialog is the innermost layer: Escape hides it first, then closes the dialog', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Dialog open onClose={onClose} title="Edit alert">
          <Button>Apply</Button>
        </Dialog>
      </StrictMode>,
    );
    const close = screen.getByRole('button', { name: 'Close' });

    await user.hover(close);
    expect(await screen.findByRole('tooltip', {}, { timeout: 1500 })).toHaveTextContent('Close');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Reads tokens.css from disk; Vitest runs with `css: false`, which empties CSS imports. */
async function loadTokensCss(): Promise<string> {
  const fsModule = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModule)) as {
    readFileSync: (path: string, encoding: 'utf8') => string;
  };
  const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
  if (!dirname) throw new Error('import.meta.dirname is unavailable; cannot locate tokens.css');
  return fs.readFileSync(`${dirname}/../../styles/tokens.css`, 'utf8');
}

function ThemePicker() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <>
      <SegmentedControl<ThemePreference>
        aria-label="Theme"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />
      <output aria-label="Resolved theme">{resolved}</output>
    </>
  );
}

describe('theme switching and chart colors (QA)', () => {
  it('switching the theme by mouse or keyboard changes the palette readThemeColors returns', async () => {
    const style = document.createElement('style');
    style.textContent = await loadTokensCss();
    document.head.append(style);
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ThemePicker />
      </StrictMode>,
    );
    const radio = (name: string) => screen.getByRole('radio', { name });
    try {
      // ** jsdom has no matchMedia, so "system" resolves to the dark-first default.
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(readThemeColors().accent).toBe('#60a5fa');

      await user.click(radio('Light'));
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(screen.getByRole('status', { name: 'Resolved theme' })).toHaveTextContent('light');
      const light = readThemeColors();
      expect(light.accent).toBe('#2563eb');
      expect(light.bgApp).toBe('#f4f5f7');
      expect(light.textPrimary).toBe('#0f172a');

      await user.keyboard('{ArrowLeft}');
      expect(radio('Dark')).toBeChecked();
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(readThemeColors().bgApp).toBe('#0b0f14');
    } finally {
      await user.click(radio('System'));
      style.remove();
    }
  });
});
