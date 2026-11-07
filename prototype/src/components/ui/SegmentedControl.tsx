import { ToggleGroup } from 'radix-ui';
import { type ReactNode } from 'react';
import type { ControlSize } from './Button';
import { cx } from './cx';
import { Tooltip } from './Tooltip';
import { useKeyboardFocusMove } from './useKeyboardFocusMove';
import './ui.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Tooltip text; use it when the label is an icon or an abbreviation. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: ControlSize;
  'aria-label': string;
  /** Ids of elements that describe the group, such as a hint below it. */
  'aria-describedby'?: string;
  disabled?: boolean;
}

/**
 * Single-choice control with radiogroup semantics. One tab stop; arrow keys (both axes) move the
 * selection and wrap, Home/End jump to the ends.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  disabled = false,
}: SegmentedControlProps<T>) {
  const { groupHandlers, movedByKeyboard } = useKeyboardFocusMove();

  const choose = (next: string) => {
    const option = options.find((o) => o.value === next);
    if (option && option.value !== value) onChange(option.value);
  };

  return (
    <ToggleGroup.Root
      type="single"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
      value={value}
      // ** Radix reports '' when the checked option is pressed again. A radio group stays checked.
      onValueChange={choose}
      disabled={disabled}
      className={cx('ui-segmented', `ui-segmented--${size}`, disabled && 'is-disabled')}
      {...groupHandlers}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            className={cx('ui-segmented__item', option.value === value && 'is-selected')}
            // ** Radix arrow keys only move focus. Selection follows focus, as in a native radio group.
            onFocus={() => {
              if (movedByKeyboard()) choose(option.value);
            }}
          >
            {option.label}
          </ToggleGroup.Item>
        );
        return option.title ? (
          <Tooltip key={option.value} content={option.title}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
