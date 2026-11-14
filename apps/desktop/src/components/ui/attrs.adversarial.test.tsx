import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Select } from './Select';
import { TextInput } from './TextInput';

// The spec gives these primitives the native attribute set ("input attrs", "select attrs",
// "button attrs") plus their own props. A native ARIA attribute the consumer passes must reach the
// element unless one of the primitive's own props says otherwise.

describe('native attributes pass through (adversarial)', () => {
  it('TextInput keeps a consumer aria-invalid when no error text is given', () => {
    // e.g. a form library marks the field invalid and shows its message elsewhere.
    render(<TextInput aria-label="Quantity" aria-invalid="true" />);
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('TextInput error still wins and sets aria-invalid', () => {
    render(<TextInput aria-label="Quantity" error="Required" />);
    expect(screen.getByRole('textbox', { name: 'Quantity' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('Select keeps a consumer aria-invalid when no error text is given', () => {
    render(
      <Select
        aria-label="Exchange"
        aria-invalid="true"
        options={[
          { value: 'nyse', label: 'NYSE' },
          { value: 'nasdaq', label: 'NASDAQ' },
        ]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Exchange' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('IconButton keeps a consumer aria-pressed when `active` is not given', () => {
    render(<IconButton label="Pin column" icon={<span />} aria-pressed="true" />);
    expect(screen.getByRole('button', { name: 'Pin column' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('IconButton `active` still controls aria-pressed when given', () => {
    render(<IconButton label="Pin column" icon={<span />} active={false} />);
    expect(screen.getByRole('button', { name: 'Pin column' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('Button keeps a consumer aria-busy when not loading', () => {
    render(<Button aria-busy="true">Refresh</Button>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
  });
});
