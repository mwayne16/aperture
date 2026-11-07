import type { ReactNode } from 'react';
import './ui.css';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Badges or status shown beside the title. */
  meta?: ReactNode;
  /** Buttons aligned to the right. */
  actions?: ReactNode;
}

/** Title row at the top of a page. The title is the page's only h1. */
export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header__text">
        <div className="ui-page-header__title-row">
          <h1 className="ui-page-header__title">{title}</h1>
          {meta}
        </div>
        {description != null && <p className="ui-page-header__description">{description}</p>}
      </div>
      {actions != null && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  );
}
