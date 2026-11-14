import { Newspaper, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import type { NewsItem } from '../../domain/types';
import { formatAge } from '../../lib/format';
import { SimulatedBadge } from '../discover/SimulatedBadge';
import { StockCard } from './StockCard';
import { useNews } from './useNews';
import { useNow } from './useNow';
import './stockPage.css';

const MINUTE_MS = 60_000;

/** Recent headlines about the symbol. Simulated items are labeled and have no links. */
export function NewsCard({ symbol }: { symbol: string }) {
  const { view, retry } = useNews(symbol);
  const simulated = view.status === 'ready' && view.items.some((item) => item.simulated);
  return (
    <StockCard
      title="News"
      className="news-card"
      meta={
        simulated && (
          <SimulatedBadge title="Sample headlines, not real news" />
        )
      }
    >
      {view.status === 'loading' && (
        <div className="news-card__loading" aria-busy="true">
          <span className="visually-hidden">Loading news</span>
          <Skeleton height={14} />
          <Skeleton height={12} width="80%" />
          <Skeleton height={14} />
          <Skeleton height={12} width="60%" />
        </div>
      )}
      {view.status === 'error' && (
        <EmptyState
          compact
          icon={<TriangleAlert />}
          title="Couldn't load news"
          description={view.message}
          action={
            <Button size="sm" icon={<RotateCw />} onClick={retry}>
              Retry
            </Button>
          }
        />
      )}
      {view.status === 'ready' && view.items.length === 0 && (
        <EmptyState compact icon={<Newspaper />} title={`No recent news for ${symbol}`} />
      )}
      {view.status === 'ready' && view.items.length > 0 && <NewsList items={view.items} />}
    </StockCard>
  );
}

function NewsList({ items }: { items: NewsItem[] }) {
  const now = useNow(MINUTE_MS);
  return (
    <ul className="news-list">
      {items.map((item) => (
        <li key={item.id} className="news-item">
          <h3 className="news-item__headline">{item.headline}</h3>
          <p className="news-item__summary">{item.summary}</p>
          <p className="news-item__meta">
            <span>{item.source}</span>
            <time dateTime={item.publishedAt}>{formatAge(Date.parse(item.publishedAt), now)}</time>
            {item.simulated && <span className="news-item__simulated">Simulated</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}
