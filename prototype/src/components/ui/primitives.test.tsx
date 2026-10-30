import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Kbd } from './Kbd';
import { Panel } from './Panel';
import { Select } from './Select';
import { Skeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { StatusDot } from './StatusDot';
import { TextInput } from './TextInput';

describe('Button', () => {
  it('defaults to a secondary md button of type="button"', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('ui-btn--secondary', 'ui-btn--md');
  });

  it('allows submit buttons and forwards refs and attributes', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} type="submit" variant="primary" size="sm" title="Go" className="extra">
        Go
      </Button>,
    );
    expect(ref.current).toHaveAttribute('type', 'submit');
    expect(ref.current).toHaveClass('ui-btn--primary', 'ui-btn--sm', 'extra');
    expect(ref.current).toHaveAttribute('title', 'Go');
  });

  it('blocks clicks and reports busy while loading, keeping its label', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not click while disabled and has no aria-busy when idle', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('replaces the icon with a spinner while loading', () => {
    const { rerender, container } = render(<Button icon={<svg data-icon="plus" />}>Add</Button>);
    expect(container.querySelector('[data-icon="plus"]')).not.toBeNull();
    rerender(
      <Button icon={<svg data-icon="plus" />} loading>
        Add
      </Button>,
    );
    expect(container.querySelector('[data-icon="plus"]')).toBeNull();
    expect(container.querySelector('.ui-spinner')).not.toBeNull();
  });
});

describe('TextInput', () => {
  it('links the label to the input', async () => {
    const user = userEvent.setup();
    render(<TextInput label="Symbol" />);
    await user.click(screen.getByText('Symbol'));
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toHaveFocus();
  });

  it('describes the input with its hint', () => {
    render(<TextInput label="Symbol" hint="Ticker or name" />);
    const input = screen.getByRole('textbox', { name: 'Symbol' });
    expect(input).toHaveAccessibleDescription('Ticker or name');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks errors with aria-invalid and replaces the hint', () => {
    render(<TextInput label="Price" hint="In USD" error="Must be greater than 0" />);
    const input = screen.getByRole('textbox', { name: 'Price' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Must be greater than 0');
    expect(screen.queryByText('In USD')).not.toBeInTheDocument();
  });

  it('treats an empty error string as no error', () => {
    render(<TextInput label="Price" hint="In USD" error="" />);
    const input = screen.getByRole('textbox', { name: 'Price' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAccessibleDescription('In USD');
  });

  it('keeps a caller-supplied id and aria-describedby', () => {
    render(
      <>
        <span id="external">External</span>
        <TextInput id="price" label="Price" aria-describedby="external" error="Bad" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Price' });
    expect(input).toHaveAttribute('id', 'price');
    expect(input).toHaveAccessibleDescription('External Bad');
  });

  it('works without a label and forwards the ref, value and handlers', async () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TextInput
        ref={ref}
        aria-label="Search"
        placeholder="Search"
        onChange={onChange}
        leadingIcon={<svg />}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(ref.current?.value).toBe('ab');
  });

  it('disables the input', () => {
    render(<TextInput label="Exchange" disabled />);
    expect(screen.getByRole('textbox', { name: 'Exchange' })).toBeDisabled();
  });

  it('gives each instance a unique id', () => {
    render(
      <>
        <TextInput label="A" />
        <TextInput label="B" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'A' }).id).not.toBe(
      screen.getByRole('textbox', { name: 'B' }).id,
    );
  });
});

describe('Select', () => {
  const options = [
    { value: 'last', label: 'Last trade price' },
    { value: 'bid', label: 'Bid' },
    { value: 'mid', label: 'Mid', disabled: true },
  ];

  it('renders labelled options including disabled ones', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Select label="Alert field" options={options} defaultValue="last" onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Alert field' });
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Mid' })).toBeDisabled();
    await user.selectOptions(select, 'bid');
    expect(select).toHaveValue('bid');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('wires errors to aria-invalid and aria-describedby', () => {
    render(<Select label="Condition" options={options} error="Choose a condition" />);
    const select = screen.getByRole('combobox', { name: 'Condition' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Choose a condition');
  });

  it('has no error wiring without an error', () => {
    render(<Select label="Condition" options={options} />);
    const select = screen.getByRole('combobox', { name: 'Condition' });
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(select).not.toHaveAttribute('aria-describedby');
  });

  it('can be disabled', () => {
    render(<Select label="Feed" options={options} disabled />);
    expect(screen.getByRole('combobox', { name: 'Feed' })).toBeDisabled();
  });
});

describe('display primitives', () => {
  it('Badge applies tone, variant and size with sensible defaults', () => {
    const { rerender } = render(<Badge>Neutral</Badge>);
    expect(screen.getByText('Neutral')).toHaveClass('ui-badge--neutral', 'ui-badge--soft', 'ui-badge--md');
    rerender(
      <Badge tone="loss" variant="solid" size="sm" title="Down">
        −4.11%
      </Badge>,
    );
    const badge = screen.getByText('−4.11%');
    expect(badge).toHaveClass('ui-badge--loss', 'ui-badge--solid', 'ui-badge--sm');
    expect(badge).toHaveAttribute('title', 'Down');
  });

  it('StatusDot shows its label and hides the decorative dot', () => {
    const { container } = render(<StatusDot tone="gain" pulse label="Live" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    const dot = container.querySelector('.ui-status__dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('is-pulsing');
  });

  it('StatusDot without a label renders only the dot', () => {
    const { container } = render(<StatusDot tone="muted" />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('.is-pulsing')).toBeNull();
  });

  it('Spinner is decorative without a label and a status with one', () => {
    const { rerender } = render(<Spinner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<Spinner size={20} label="Loading chart" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart');
  });

  it('Skeleton converts numeric sizes to px, clamps negatives, and is hidden from assistive tech', () => {
    const { container, rerender } = render(<Skeleton width={120} height={10} radius={2} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('10px');
    expect(el.style.borderRadius).toBe('2px');
    rerender(<Skeleton width="40%" height={-4} radius={-1} />);
    expect(el.style.width).toBe('40%');
    expect(el.style.height).toBe('0px');
    expect(el.style.borderRadius).toBe('0px');
    rerender(<Skeleton />);
    expect(el.style.width).toBe('100%');
    expect(el.style.borderRadius).toBe('');
  });

  it('Kbd renders a kbd element', () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc').tagName).toBe('KBD');
  });

  it('EmptyState renders optional parts only when given', () => {
    const { rerender, container } = render(<EmptyState title="No alerts yet" />);
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    expect(container.querySelector('.ui-empty__icon, .ui-empty__description, .ui-empty__action')).toBeNull();
    rerender(
      <EmptyState
        compact
        icon={<svg />}
        title="No matches"
        description="Try AAPL"
        action={<button type="button">Clear</button>}
      />,
    );
    expect(container.firstElementChild).toHaveClass('ui-empty--compact');
    expect(screen.getByText('Try AAPL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('Panel labels its region by a text title and renders actions and classes', () => {
    render(
      <Panel title="Watchlist" actions={<button type="button">Add</button>} className="p" bodyClassName="b">
        <p>Rows</p>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Watchlist' });
    expect(region).toHaveClass('ui-panel', 'p');
    expect(screen.getByRole('heading', { name: 'Watchlist', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByText('Rows').parentElement).toHaveClass('ui-panel__body', 'b');
  });

  it('Panel without a header renders only the body', () => {
    const { container } = render(
      <Panel>
        <p>Body only</p>
      </Panel>,
    );
    expect(container.querySelector('.ui-panel__header')).toBeNull();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('Panel labels its region by a node title without forcing a heading', () => {
    render(
      <Panel title={<span>Quotes</span>}>
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Quotes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
