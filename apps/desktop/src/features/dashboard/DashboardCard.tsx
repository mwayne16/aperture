import { CircleAlert, RefreshCw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatClock } from '../../lib/format';

interface DashboardCardProps {
  title: string;
  /** Badges or small text beside the title. */
  meta?: ReactNode;
  /** Right-aligned header content: a link to the full page or a control. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A rounded dashboard card with a titled header. The title names the card's region. */
export function DashboardCard({ title, meta, actions, children, className }: DashboardCardProps) {
  const titleId = useId();
  return (
    <section className={cx('dash-card', className)} aria-labelledby={titleId}>
      <div className="dash-card__header">
        <div className="dash-card__heading">
          <h2 id={titleId} className="dash-card__title">
            {title}
          </h2>
          {meta}
        </div>
        {actions != null && <div className="dash-card__actions">{actions}</div>}
      </div>
      <div className="dash-card__body">{children}</div>
    </section>
  );
}

/** A card's failed first load, with a Retry that asks again. */
export function CardError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="dash-card__state">
      <EmptyState
        compact
        icon={<CircleAlert />}
        title={title}
        description={message}
        action={
          <Button size="sm" icon={<RefreshCw />} onClick={onRetry}>
            Retry
          </Button>
        }
      />
    </div>
  );
}

/** Placeholder rows shaped like the card's list while its data loads. */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <ul className="dash-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="dash-skeleton-row">
          <Skeleton width={48} height={12} />
          <Skeleton width="35%" height={10} />
          <span className="dash-spacer" />
          <Skeleton width={56} height={12} />
          <Skeleton width={52} height={16} />
        </li>
      ))}
    </ul>
  );
}

interface FreshnessProps {
  /** When the shown data was produced (epoch ms), or null when unknown. */
  asOf: number | null;
  /** Why the latest refresh failed, while older data stays on screen. */
  refreshError: string | null;
  onRetry: () => void;
}

/** "as of 14:05:09 ET" for polled data, with a warning and a Retry once a refresh fails. */
export function Freshness({ asOf, refreshError, onRetry }: FreshnessProps) {
  return (
    <span className={cx('dash-card__asof num', refreshError !== null && 'is-stale')}>
      {refreshError !== null && (
        <>
          <CircleAlert className="dash-card__stale-icon" aria-hidden="true" />
          <span role="status" className="visually-hidden">
            Couldn't refresh. {refreshError}
          </span>
        </>
      )}
      {asOf !== null && <span>as of {formatClock(asOf)} ET</span>}
      {refreshError !== null && (
        <IconButton label="Couldn't refresh. Retry" size="sm" icon={<RefreshCw />} onClick={onRetry} />
      )}
    </span>
  );
}
