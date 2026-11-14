import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '../../data/api';
import type { ChartRange, HistoryResult } from '../../domain/types';
import { historyCache, isAbortError } from './historyCache';

export type HistoryView =
  | { status: 'loading' }
  | { status: 'ready'; result: HistoryResult }
  | { status: 'error'; message: string };

interface Settled {
  /** The request this outcome belongs to. Any other request's outcome is never shown. */
  requestKey: string;
  view: HistoryView;
}

const LOADING: HistoryView = { status: 'loading' };

function errorMessage(error: unknown): string {
  return isApiError(error) ? error.message : 'Something went wrong while loading price history.';
}

/**
 * History for one symbol and range. A fresh cached result shows at once; otherwise the view is
 * loading until this exact request settles, so a slow earlier request can never replace newer data.
 * Changing the symbol or range, or unmounting, cancels the request. `retry` starts a new one.
 */
export function useHistory(symbol: string, range: ChartRange): { view: HistoryView; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestKey = `${symbol}|${range}|${attempt}`;
  const [currentKey, setCurrentKey] = useState(requestKey);
  // ** Leaving a key drops its outcome, so returning to it (1D -> 1W -> 1D) waits for the new request
  // instead of showing the old error.
  if (currentKey !== requestKey) {
    setCurrentKey(requestKey);
    setSettled(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    historyCache.load(symbol, range, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setSettled({ requestKey, view: { status: 'ready', result } });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setSettled({ requestKey, view: { status: 'error', message: errorMessage(error) } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [symbol, range, requestKey]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  if (settled?.requestKey === requestKey) return { view: settled.view, retry };
  const cached = historyCache.peek(symbol, range);
  return { view: cached ? { status: 'ready', result: cached } : LOADING, retry };
}
