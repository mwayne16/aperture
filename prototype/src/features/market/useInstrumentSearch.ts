import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../data/api';
import { api } from '../../data/dataLayer';
import type { Instrument } from '../../domain/types';
import { rememberInstruments } from './instrumentStore';

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 8;
const NO_RESULTS: Instrument[] = [];

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SettledSearch {
  term: string;
  results: Instrument[];
  error: string | null;
}

interface InstrumentSearch {
  status: SearchStatus;
  /** Results of the latest finished search. While loading they may belong to an earlier query. */
  results: Instrument[];
  error: string | null;
  /**
   * Searches `term` now instead of after the debounce, joining a request already running for it.
   * Resolves with the results, or null when the search failed or a newer search replaced it.
   */
  searchNow(term: string): Promise<Instrument[] | null>;
}

function isPrefixRelated(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Debounced instrument search for a query. Only the most recently started request may update the
 * results, so a slow response for an older query never overwrites newer results.
 */
export function useInstrumentSearch(query: string): InstrumentSearch {
  const term = query.trim();
  const [settled, setSettled] = useState<SettledSearch>({ term: '', results: NO_RESULTS, error: null });
  const latestRequest = useRef(0);
  const inFlight = useRef<{ term: string; promise: Promise<Instrument[] | null> } | null>(null);

  const searchNow = useCallback((searchTerm: string): Promise<Instrument[] | null> => {
    if (inFlight.current?.term === searchTerm) return inFlight.current.promise;
    latestRequest.current += 1;
    const id = latestRequest.current;
    const isLatest = () => id === latestRequest.current;
    const promise = api.searchInstruments(searchTerm, SEARCH_LIMIT).then(
      (results) => {
        if (!isLatest()) return null;
        inFlight.current = null;
        rememberInstruments(results);
        setSettled({ term: searchTerm, results, error: null });
        return results;
      },
      (error: unknown) => {
        if (!isLatest()) return null;
        inFlight.current = null;
        const message = isApiError(error) ? error.message : 'Search failed.';
        setSettled({ term: searchTerm, results: NO_RESULTS, error: message });
        return null;
      },
    );
    inFlight.current = { term: searchTerm, promise };
    return promise;
  }, []);

  useEffect(() => {
    if (term === '') {
      // Clearing the box drops any request still running.
      latestRequest.current += 1;
      inFlight.current = null;
      return;
    }
    const timer = setTimeout(() => {
      void searchNow(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [term, searchNow]);

  useEffect(
    () => () => {
      latestRequest.current += 1;
      inFlight.current = null;
    },
    [],
  );

  if (term === '') return { status: 'idle', results: NO_RESULTS, error: null, searchNow };
  if (settled.term !== term) {
    // ** Older results stay up only while the user extends or trims the same text, so the list
    // doesn't blink on every keystroke but never shows matches for an unrelated earlier query.
    const related = isPrefixRelated(settled.term, term);
    return { status: 'loading', results: related ? settled.results : NO_RESULTS, error: null, searchNow };
  }
  return {
    status: settled.error === null ? 'ready' : 'error',
    results: settled.results,
    error: settled.error,
    searchNow,
  };
}
