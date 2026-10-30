import type { ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export type BadgeTone = 'neutral' | 'accent' | 'gain' | 'loss' | 'warning' | 'muted';

interface BadgeProps {
  tone?: BadgeTone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  children: ReactNode;
  title?: string;
}

export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', children, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx('ui-badge', `ui-badge--${tone}`, `ui-badge--${variant}`, `ui-badge--${size}`)}
    >
      {children}
    </span>
  );
}
