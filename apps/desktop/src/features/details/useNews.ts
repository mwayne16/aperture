import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import type { NewsItem } from '../../domain/types';

export type NewsView =
  | { status: 'loading' }
  | { status: 'ready'; items: NewsItem[] }
  | { status: 'error'; message: string };

const NEWS_LIMIT = 5;
const LOADING: NewsView = { status: 'loading' };

// Requests in flight, so a StrictMode remount shares one request instead of sending a second.
const inflight = new Map<string, Promise<NewsItem[]>>();

function fetchNews(symbol: string): Promise<NewsItem[]> {
  let request = inflight.get(symbol);
  if (!request) {
    request = api.getNews({ symbols: [symbol], limit: NEWS_LIMIT }).finally(() => inflight.delete(symbol));
    inflight.set(symbol, request);
  }
  return request;
}

interface Settled {
  requestKey: string;
  view: NewsView;
}

/** Latest news about one symbol. Results for an earlier symbol or attempt are ignored. */
export function useNews(symbol: string): { view: NewsView; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestKey = `${symbol}|${attempt}`;

  useEffect(() => {
    let current = true;
    fetchNews(symbol).then(
      (items) => {
        if (current) setSettled({ requestKey, view: { status: 'ready', items } });
      },
      (error: unknown) => {
        if (!current) return;
        const message = isApiError(error) ? error.message : 'News could not be loaded.';
        setSettled({ requestKey, view: { status: 'error', message } });
      },
    );
    return () => {
      current = false;
    };
  }, [symbol, requestKey]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { view: settled?.requestKey === requestKey ? settled.view : LOADING, retry };
}
