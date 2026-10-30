import { useId, type ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

interface PanelProps {
  title?: ReactNode;
  /** Right-aligned header content (icon buttons, a segmented control). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Bordered pane with a fixed header bar and a body that scrolls on its own. */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  const titleId = useId();
  const hasTitle = title != null && title !== false && title !== '';
  const hasHeader = hasTitle || actions != null;
  const titleIsText = typeof title === 'string' || typeof title === 'number';
  return (
    <section className={cx('ui-panel', className)} aria-labelledby={hasTitle ? titleId : undefined}>
      {hasHeader && (
        <header className="ui-panel__header">
          {titleIsText && hasTitle ? (
            <h2 id={titleId} className="ui-panel__title">
              {title}
            </h2>
          ) : (
            <div id={hasTitle ? titleId : undefined} className="ui-panel__title">
              {hasTitle && title}
            </div>
          )}
          {actions != null && <div className="ui-panel__actions">{actions}</div>}
        </header>
      )}
      <div className={cx('ui-panel__body', bodyClassName)}>{children}</div>
    </section>
  );
}
