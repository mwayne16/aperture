import { ChevronDown, ChevronUp, Newspaper } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link } from 'wouter';
import { paths } from '../../app/routes';
import { cx } from '../../components/ui/cx';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { api } from '../../data/dataLayer';
import type { NewsItem } from '../../domain/types';
import { formatAge, formatDateTime } from '../../lib/format';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { usePolledRequest } from '../discover/usePolledRequest';
import { useNow } from '../shell/useNow';
import { CardError, DashboardCard } from './DashboardCard';

/** Most stories the expanded feed holds. */
const NEWS_LIMIT = 25;
/** Stories shown before the feed is expanded. */
const COLLAPSED_STORIES = 5;
const NEWS_REFRESH_MS = 5 * 60_000;

/**
 * Recent market headlines, newest first: five at a time, with Show more opening the rest in a
 * scrolling list so the card keeps its height. Simulated items say so and never link anywhere.
 */
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
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [expanded, setExpanded] = useState(false);
  // ** A refresh can return five stories or fewer, which leaves nothing to expand into.
  const canExpand = items.length > COLLAPSED_STORIES;
  const open = expanded && canExpand;
  const shown = open ? items : items.slice(0, COLLAPSED_STORIES);

  const toggle = () => {
    // Collapsing starts the list from the top again, so the next expand doesn't open midway.
    if (open && listRef.current) listRef.current.scrollTop = 0;
    setExpanded(!open);
  };

  return (
    <>
      <ul id={listId} ref={listRef} className={cx('dash-news__list', open && 'is-expanded')}>
        {shown.map((item) => (
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
      {canExpand && (
        <div className="dash-news__footer">
          <button
            type="button"
            className="dash-news__toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={toggle}
          >
            {open ? 'Show less' : 'Show more'}
            {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
        </div>
      )}
    </>
  );
}

function NewsSkeleton() {
  return (
    <ul className="dash-news__list" aria-hidden="true">
      {Array.from({ length: COLLAPSED_STORIES }, (_, i) => (
        <li key={i} className="dash-story">
          <Skeleton width="80%" height={13} />
          <Skeleton width="95%" height={10} />
          <Skeleton width="40%" height={10} />
        </li>
      ))}
    </ul>
  );
}
