import type { ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Tighter spacing for small panes and table bodies. */
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact')}>
      {icon != null && (
        <span className="ui-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="ui-empty__title">{title}</p>
      {description != null && <div className="ui-empty__description">{description}</div>}
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
