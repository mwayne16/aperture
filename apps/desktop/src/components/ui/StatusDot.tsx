import { cx } from './cx';
import './ui.css';

type StatusTone = 'gain' | 'loss' | 'warning' | 'muted' | 'accent';

interface StatusDotProps {
  tone: StatusTone;
  /** Animated halo for "live" states. Static under prefers-reduced-motion. */
  pulse?: boolean;
  /** Visible text next to the dot. Without it the dot is decorative. */
  label?: string;
}

export function StatusDot({ tone, pulse = false, label }: StatusDotProps) {
  return (
    <span className={cx('ui-status', `ui-status--${tone}`)}>
      <span className={cx('ui-status__dot', pulse && 'is-pulsing')} aria-hidden="true" />
      {label && <span className="ui-status__label">{label}</span>}
    </span>
  );
}
