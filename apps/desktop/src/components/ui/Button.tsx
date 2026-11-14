import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';
import './ui.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: ReactNode;
  /**
   * Shows a spinner, sets aria-busy and blocks clicks. The label stays so the width doesn't jump.
   * When not loading, a consumer `aria-busy` passes through.
   */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  'aria-busy': ariaBusy,
  ref,
  ...rest
}: ButtonProps) {
  const leading = loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : ariaBusy}
      className={cx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        loading && 'is-loading',
        children == null && 'ui-btn--icon-only',
        className,
      )}
    >
      {leading != null && (
        <span className="ui-btn__icon" aria-hidden="true">
          {leading}
        </span>
      )}
      {children != null && <span className="ui-btn__label">{children}</span>}
    </button>
  );
}
