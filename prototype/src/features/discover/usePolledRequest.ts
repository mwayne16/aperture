import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { isApiError } from '../../data/api';

export type RequestView<T> =
  | { status: 'loading' }
  /** `receivedAt` is when the data arrived (epoch ms), or null for data served from a cache. */
  | { status: 'ready'; data: T; receivedAt: number | null; refreshError: string | null }
  | { status: 'error'; message: string };

interface Outcome<T> {
  key: string;
  attempt: number;
  data: T | undefined;
  receivedAt: number | null;
  error: string | null;
}

interface PolledRequestOptions<T> {
  /** Ask again this long after each answer. Null asks once. */
  refreshMs: number | null;
  /** Data already at hand for `key`, shown instead of a loading state. */
  peek?: () => T | undefined;
}

function messageOf(error: unknown): string {
  return isApiError(error) ? error.message : 'Something went wrong. Try again.';
}

/**
 * Runs `request` for `key` now and again `refreshMs` after each answer while mounted. Only answers
 * for the current key are shown, so a slow answer for an old key (a previous tab) never replaces
 * newer data. A failed refresh keeps the last data and reports the error beside it. `retry` asks
 * again at once and shows loading until that answer arrives when there is no data to keep.
 */
export function usePolledRequest<T>(
  key: string,
  request: () => Promise<T>,
  { refreshMs, peek }: PolledRequestOptions<T>,
): { view: RequestView<T>; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);
  const [outcomeKey, setOutcomeKey] = useState(key);
  const send = useEffectEvent(request);
  // ** Leaving a key drops its outcome, so coming back to it (stocks -> crypto -> stocks) waits for a
  // new answer instead of showing an old error or old prices.
  if (outcomeKey !== key) {
    setOutcomeKey(key);
    setOutcome(null);
  }

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const data = await send();
        if (!active) return;
        setOutcome({ key, attempt, data, receivedAt: Date.now(), error: null });
      } catch (error) {
        if (!active) return;
        const message = messageOf(error);
        setOutcome((previous) =>
          previous?.key === key && previous.data !== undefined
            ? { ...previous, error: message }
            : { key, attempt, data: undefined, receivedAt: null, error: message },
        );
      }
      if (refreshMs !== null) {
        timer = setTimeout(() => {
          void poll();
        }, refreshMs);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, attempt, refreshMs]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const current = outcome?.key === key ? outcome : null;
  if (current?.data !== undefined) {
    return {
      view: {
        status: 'ready',
        data: current.data,
        receivedAt: current.receivedAt,
        refreshError: current.error,
      },
      retry,
    };
  }
  // ** An error from an earlier attempt gives way to loading, so Retry shows that it is working.
  if (current?.error != null && current.attempt === attempt) {
    return { view: { status: 'error', message: current.error }, retry };
  }
  const cached = peek?.();
  if (cached !== undefined) {
    return { view: { status: 'ready', data: cached, receivedAt: null, refreshError: null }, retry };
  }
  return { view: { status: 'loading' }, retry };
}
