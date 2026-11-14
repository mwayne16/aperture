/*
 * Round 2 adversarial tests: primitives composed the way feature teams will use them.
 * - Dialog focus trap with roving-tabindex children (Tabs / SegmentedControl have one tab stop).
 * - Toast hover pause combined with manual dismiss.
 * - readThemeColors covers every color token the spec lists.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { SegmentedControl } from './SegmentedControl';
import { Tabs } from './Tabs';
import { readThemeColors, type ThemeColors } from './theme';
import { dismissAllToasts, showToast } from './toastStore';
import { ToastViewport } from './ToastViewport';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
  vi.useRealTimers();
});

function DialogWithRovingGroups() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('b');
  const [range, setRange] = useState<'1D' | '5D' | '1M'>('1M');
  return (
    <Dialog open onClose={() => undefined} title="Chart settings" footer={<Button>Apply</Button>}>
      <Tabs
        aria-label="Section"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'a', label: 'General' },
          { value: 'b', label: 'Series' },
          { value: 'c', label: 'Axes' },
        ]}
      />
      <SegmentedControl
        aria-label="Range"
        value={range}
        onChange={setRange}
        options={[
          { value: '1D', label: '1D' },
          { value: '5D', label: '5D' },
          { value: '1M', label: '1M' },
        ]}
      />
    </Dialog>
  );
}

describe('Dialog with roving-tabindex children (adversarial)', () => {
  it('lands on the selected tab (the only tab stop), not on the first tab', () => {
    render(<DialogWithRovingGroups />);
    expect(screen.getByRole('tab', { name: 'Series' })).toHaveFocus();
  });

  it('Tab visits each group once and wraps inside the dialog in both directions', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Behind</button>
        <DialogWithRovingGroups />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Chart settings' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const series = within(dialog).getByRole('tab', { name: 'Series' });
    const oneMonth = within(dialog).getByRole('radio', { name: '1M' });
    const apply = within(dialog).getByRole('button', { name: 'Apply' });

    expect(series).toHaveFocus();
    await user.tab();
    expect(oneMonth).toHaveFocus();
    await user.tab();
    expect(apply).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(series).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(apply).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Behind', hidden: true })).not.toHaveFocus();
  });

  it('arrow keys inside a group move the tab stop without breaking the trap', async () => {
    const user = userEvent.setup();
    render(<DialogWithRovingGroups />);
    await user.keyboard('{End}');
    const axes = screen.getByRole('tab', { name: 'Axes' });
    expect(axes).toHaveFocus();
    expect(axes).toHaveAttribute('aria-selected', 'true');
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(axes).toHaveFocus();
  });

  it('Escape from inside a group still closes the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        <Tabs
          aria-label="S"
          value="x"
          onChange={() => undefined}
          tabs={[
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ]}
        />
      </Dialog>,
    );
    expect(screen.getByRole('tab', { name: 'X' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Toasts: hover pause with manual dismiss (adversarial)', () => {
  it('dismissing one toast while hovered keeps the others paused, then they resume with their remaining time', () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    let first = '';
    act(() => {
      first = showToast({ tone: 'info', title: 'First' });
      showToast({ tone: 'warning', title: 'Second' });
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    fireEvent.mouseEnter(region);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(region).getByText('First')).toBeInTheDocument();
    expect(within(region).getByText('Second')).toBeInTheDocument();

    const firstItem = within(region).getByText('First').closest('li');
    expect(firstItem).not.toBeNull();
    fireEvent.click(within(firstItem as HTMLElement).getByRole('button', { name: 'Dismiss notification' }));
    expect(within(region).queryByText('First')).not.toBeInTheDocument();
    expect(first).not.toBe('');

    // Still hovered: the remaining toast must not count down.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(region).getByText('Second')).toBeInTheDocument();

    fireEvent.mouseLeave(region);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(within(region).getByText('Second')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(within(region).queryByText('Second')).not.toBeInTheDocument();
  });

  it('every toast in the stack has its own reachable dismiss button and shows its description', () => {
    render(<ToastViewport />);
    act(() => {
      for (let i = 1; i <= 7; i++) showToast({ tone: 'error', title: `T${i}`, description: `D${i}` });
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.querySelector('.ui-toast__title')?.textContent)).toEqual([
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
    ]);
    for (const li of items) {
      expect(within(li).getByRole('button', { name: 'Dismiss notification' })).toBeEnabled();
      expect(li).toHaveTextContent(/D\d/);
    }
  });
});

describe('readThemeColors contract (adversarial)', () => {
  it('returns every color token the spec requires, as non-empty strings', () => {
    const colors = readThemeColors();
    const required: (keyof ThemeColors)[] = [
      'bgApp',
      'bgChrome',
      'bgPanel',
      'bgRaised',
      'bgInput',
      'bgHover',
      'bgSelected',
      'border',
      'borderStrong',
      'textPrimary',
      'textMuted',
      'textFaint',
      'accent',
      'accentHover',
      'textOnAccent',
      'gain',
      'loss',
      'gainTint',
      'lossTint',
      'warning',
      'warningTint',
      'focusRing',
      'shadowWindow',
    ];
    for (const key of required) {
      expect(typeof colors[key], key).toBe('string');
      expect(colors[key].length, key).toBeGreaterThan(0);
    }
  });

  it('returns a fresh object each call so callers cannot corrupt the fallback palette', () => {
    const a = readThemeColors();
    a.accent = 'red';
    const b = readThemeColors();
    expect(b.accent).not.toBe('red');
  });
});
