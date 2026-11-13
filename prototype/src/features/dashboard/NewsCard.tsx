import { Newspaper } from 'lucide-react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { api } from '../../data/dataLayer';
import type { NewsItem } from '../../domain/types';
import { formatAge, formatDateTime } from '../../lib/format';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { usePolledRequest } from '../discover/usePolledRequest';
import { useNow } from '../shell/useNow';
import { CardError, DashboardCard } from './DashboardCard';

const NEWS_LIMIT = 6;
const NEWS_REFRESH_MS = 5 * 60_000;

/** Recent market headlines, newest first. Simulated items say so and never link anywhere. */
export function NewsCard() {
  const { view, retry } = usePolledRequest<NewsItem[]>('news', () => api.getNews({ limit: NEWS_LIMIT }), {
    refreshMs: NEWS_REFRESH_MS,
  });

  let body;
  if (view.status === 'loading') {
    body = <NewsSkeleton />;
  } else if (view.status === 'error') {
    body = <CardError title="Couldn't load news" message={view.message} onRetry={retry} />;
  } else if (view.data.length === 0) {
    body = (
      <EmptyState
        compact
        icon={<Newspaper />}
        title="No news right now"
        description="New stories appear here as they're published."
      />
    );
  } else {
    body = <NewsList items={view.data} />;
  }

  return (
    <DashboardCard title="Market news" className="dash-news">
      {body}
    </DashboardCard>
  );
}

function NewsList({ items }: { items: readonly NewsItem[] }) {
  const now = useNow();
  return (
    <ul className="dash-news__list">
      {items.map((item) => (
        <li key={item.id}>
          <article className="dash-story">
            <h3 className="dash-story__headline">
              {item.url !== null && !item.simulated ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.headline}
                </a>
              ) : (
                item.headline
              )}
            </h3>
            <p className="dash-story__summary">{item.summary}</p>
            <div className="dash-story__meta">
              {item.simulated && <SimulatedBadge title="Sample text, not a real news story." />}
              <span>{item.source}</span>
              <time dateTime={item.publishedAt} title={formatDateTime(item.publishedAt)}>
                {formatAge(Date.parse(item.publishedAt), now)}
              </time>
              {item.symbols.map((symbol) => (
                <Link key={symbol} href={paths.symbol(symbol)} className="dash-story__symbol">
                  {symbol}
                </Link>
              ))}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}

function NewsSkeleton() {
  return (
    <ul className="dash-news__list" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="dash-story">
          <Skeleton width="80%" height={13} />
          <Skeleton width="95%" height={10} />
          <Skeleton width="40%" height={10} />
        </li>
      ))}
    </ul>
  );
}
