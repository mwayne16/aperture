import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import type { Instrument } from '../../domain/types';

export type InstrumentView =
  | { status: 'loading' }
  /** `instrument` is null when the provider doesn't know the symbol. */
  | { status: 'ready'; instrument: Instrument | null }
  | { status: 'error'; message: string };

// Instrument details don't change during a session, so each successful lookup is kept. Failures aren't.
const lookups = new Map<string, Instrument | null>();
// Lookups in flight, so a StrictMode remount or a quick A -> B -> A selection shares one request.
const inflight = new Map<string, Promise<Instrument | null>>();

/** Forgets every lookup (tests). */
export function clearInstrumentCache(): void {
  lookups.clear();
  inflight.clear();
}

function lookUp(symbol: string): Promise<Instrument | null> {
  const known = lookups.get(symbol);
  if (known !== undefined) return Promise.resolve(known);
  let request = inflight.get(symbol);
  if (!request) {
    request = api.getInstrument(symbol).then(
      (instrument) => {
        lookups.set(symbol, instrument);
        inflight.delete(symbol);
        return instrument;
      },
      (error: unknown) => {
        inflight.delete(symbol);
        throw error;
      },
    );
    inflight.set(symbol, request);
  }
  return request;
}

interface Settled {
  requestKey: string;
  view: InstrumentView;
}

const LOADING: InstrumentView = { status: 'loading' };

/** Company name and exchange for a normalized symbol. Results for an earlier symbol are ignored. */
export function useInstrument(symbol: string): { view: InstrumentView; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const requestKey = `${symbol}|${attempt}`;
  const [currentKey, setCurrentKey] = useState(requestKey);
  // ** Leaving a symbol drops its outcome, so coming back to it never shows an old error.
  if (currentKey !== requestKey) {
    setCurrentKey(requestKey);
    setSettled(null);
  }

  useEffect(() => {
    let current = true;
    lookUp(symbol).then(
      (instrument) => {
        if (current) setSettled({ requestKey, view: { status: 'ready', instrument } });
      },
      (error: unknown) => {
        if (!current) return;
        const message = isApiError(error) ? error.message : 'Company details could not be loaded.';
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

  if (settled?.requestKey === requestKey) return { view: settled.view, retry };
  const known = lookups.get(symbol);
  return { view: known !== undefined ? { status: 'ready', instrument: known } : LOADING, retry };
}
