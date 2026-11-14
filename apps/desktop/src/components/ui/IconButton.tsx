import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import type { ControlSize } from './Button';
import { cx } from './cx';
import { Tooltip } from './Tooltip';
import './ui.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Accessible name and tooltip text. */
  label: string;
  icon: ReactNode;
  size?: ControlSize;
  variant?: 'ghost' | 'secondary';
  /** Toggled-on state (e.g. a pinned filter). Sets aria-pressed when provided, else a consumer `aria-pressed` passes through. */
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  size = 'md',
  variant = 'ghost',
  active,
  type = 'button',
  className,
  'aria-pressed': ariaPressed,
  ref,
  ...rest
}: IconButtonProps) {
  const pressed = active ?? ariaPressed;
  return (
    <Tooltip content={label}>
      <button
        {...rest}
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={cx(
          'ui-iconbtn',
          `ui-iconbtn--${variant}`,
          `ui-iconbtn--${size}`,
          (pressed === true || pressed === 'true') && 'is-active',
          className,
        )}
      >
        <span className="ui-iconbtn__icon" aria-hidden="true">
          {icon}
        </span>
      </button>
    </Tooltip>
  );
}
