import { useId, type ReactNode } from 'react';
import { cx } from '../../components/ui/cx';
import './stockPage.css';

interface StockCardProps {
  title: string;
  /** Small text beside the title, such as the bar size or a Simulated marker. */
  meta?: ReactNode;
  /** Controls aligned to the right of the header. They wrap below the title when space runs out. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A rounded card on the stock page: a titled header (an h2 under the page's h1), then its content. */
export function StockCard({ title, meta, actions, children, className }: StockCardProps) {
  const titleId = useId();
  return (
    <section className={cx('stock-card', className)} aria-labelledby={titleId}>
      <header className="stock-card__header">
        <div className="stock-card__heading">
          <h2 id={titleId} className="stock-card__title">
            {title}
          </h2>
          {meta != null && <div className="stock-card__meta">{meta}</div>}
        </div>
        {actions != null && <div className="stock-card__actions">{actions}</div>}
      </header>
      <div className="stock-card__body">{children}</div>
    </section>
  );
}
