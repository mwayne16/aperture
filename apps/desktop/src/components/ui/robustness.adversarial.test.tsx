import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShowcasePage } from '../../app/ShowcasePage';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Menu } from './Menu';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';
import { Tabs } from './Tabs';
import { Tooltip } from './Tooltip';

describe('primitives inside a form (adversarial)', () => {
  function InForm({ children }: { children: ReactNode }) {
    return (
      <form
        aria-label="Order ticket"
        onSubmit={(e) => {
          e.preventDefault();
          submitted();
        }}
      >
        {children}
      </form>
    );
  }
  const submitted = vi.fn();

  it('no control submits the surrounding form when activated', async () => {
    submitted.mockClear();
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      const [seg, setSeg] = useState<'a' | 'b'>('a');
      const [tab, setTab] = useState<'x' | 'y'>('x');
      return (
        <InForm>
          <Button>Plain</Button>
          <IconButton label="Pin" icon={<span>P</span>} />
          <Switch checked={on} onChange={setOn} label="Notify" />
          <SegmentedControl
            aria-label="Side"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B', title: 'Option B' },
            ]}
          />
          <Tabs
            aria-label="Views"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'x', label: 'X' },
              { value: 'y', label: 'Y', badge: 2 },
            ]}
          />
          <Menu
            trigger={(p) => <Button {...p}>More</Button>}
            items={[{ id: 'one', label: 'One', onSelect: vi.fn() }]}
          />
        </InForm>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Plain' }));
    await user.click(screen.getByRole('button', { name: 'Pin' }));
    await user.click(screen.getByRole('switch', { name: 'Notify' }));
    await user.click(screen.getByRole('radio', { name: 'B' }));
    await user.click(screen.getByRole('tab', { name: /Y/ }));
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.keyboard('{Escape}');
    screen.getByRole('switch', { name: 'Notify' }).focus();
    await user.keyboard('{Enter}');
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('empty collections (adversarial)', () => {
  it('Tabs and SegmentedControl with no items render and ignore navigation keys', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Tabs aria-label="Empty tabs" tabs={[]} value="" onChange={onChange} />
        <SegmentedControl aria-label="Empty seg" options={[]} value="" onChange={onChange} />
      </>,
    );
    expect(screen.getByRole('tablist', { name: 'Empty tabs' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Empty seg' })).toBeInTheDocument();
    screen.getByRole('tablist').focus();
    await user.keyboard('{ArrowRight}{Home}{End}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a Menu with no items opens, survives arrow keys and typing, and Escape returns focus', async () => {
    const user = userEvent.setup();
    render(<Menu trigger={(p) => <Button {...p}>Actions</Button>} items={[]} />);
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowUp}{Home}{End}a');
    expect(menu).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus();
  });
});

describe('Tooltip content changes (adversarial)', () => {
  it('keeps the same focused trigger node when its content becomes empty and comes back', async () => {
    const user = userEvent.setup();
    function Harness({ content }: { content: string }) {
      return (
        <Tooltip content={content}>
          <button>Refresh</button>
        </Tooltip>
      );
    }
    const { rerender } = render(<Harness content="Reload quotes" />);
    await user.tab();
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toHaveFocus();
    rerender(<Harness content="" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    rerender(<Harness content="Reload quotes" />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBe(button);
  });

  it('updates the visible text when content changes while open', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Tooltip content="Connected">
        <button>Feed</button>
      </Tooltip>,
    );
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Connected');
    rerender(
      <Tooltip content="Reconnecting">
        <button>Feed</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Reconnecting');
  });
});

describe('Showcase covers the required states (adversarial)', () => {
  it('shows disabled, loading, error and selected states across primitives', () => {
    render(<ShowcasePage />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.some((b) => b.hasAttribute('disabled') && !b.hasAttribute('aria-busy'))).toBe(true);
    expect(buttons.some((b) => b.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(screen.getAllByRole('textbox').some((t) => t.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(
      screen.getAllByRole('combobox').some((s) => s.getAttribute('aria-invalid') === 'true'),
    ).toBe(true);
    expect(screen.getAllByRole('combobox').some((s) => s.hasAttribute('disabled'))).toBe(true);
    const switches = screen.getAllByRole('switch');
    expect(switches.some((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);
    expect(switches.some((s) => s.hasAttribute('disabled'))).toBe(true);
    expect(screen.getAllByRole('tab', { selected: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('radio', { checked: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(document.querySelector('kbd')).not.toBeNull();
    expect(buttons.some((b) => b.getAttribute('aria-haspopup') === 'menu')).toBe(true);
  });

  it('the quote table has the specified columns in order, 10 rows and one selected row', () => {
    render(<ShowcasePage />);
    const table = screen.getByRole('grid', { name: /quotes/i });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent.trim());
    expect(headers).toEqual(['Symbol', 'Last', 'Chg', 'Chg%', 'Bid', 'Ask', 'Volume']);
    const bodyRows = within(table).getAllByRole('row').slice(1);
    expect(bodyRows).toHaveLength(10);
    expect(bodyRows.filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(table.querySelectorAll('.is-gain').length).toBeGreaterThan(0);
    expect(table.querySelectorAll('.is-loss').length).toBeGreaterThan(0);
  });
});
