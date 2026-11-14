import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../../data/dataLayer';
import { normalizeSymbol } from '@aperture/shared/symbols';
import type { Instrument } from '../../domain/types';

/**
 * Instrument details (company name, exchange) by symbol, so table rows can label symbols.
 * Each symbol is fetched once; a failed fetch is forgotten so the next row that needs it retries.
 */

type InstrumentEntry =
  | { status: 'loading' }
  /** `instrument` is null when the symbol is valid but not a known listing. */
  | { status: 'ready'; instrument: Instrument | null };

interface InstrumentStoreState {
  entries: Readonly<Record<string, InstrumentEntry>>;
}

export const useInstrumentStore = create<InstrumentStoreState>()(() => ({ entries: {} }));

function setEntry(symbol: string, entry: InstrumentEntry | null): void {
  useInstrumentStore.setState((state) => {
    const { [symbol]: _previous, ...rest } = state.entries;
    return { entries: entry ? { ...rest, [symbol]: entry } : rest };
  });
}

function ensureInstrument(symbol: string): void {
  const existing = useInstrumentStore.getState().entries[symbol];
  if (existing) return;
  setEntry(symbol, { status: 'loading' });
  api.getInstrument(symbol).then(
    (instrument) => {
      setEntry(symbol, { status: 'ready', instrument });
    },
    () => {
      setEntry(symbol, null);
    },
  );
}

/** Caches instruments the search already returned, so adding one needs no extra request. */
export function rememberInstruments(instruments: readonly Instrument[]): void {
  const { entries } = useInstrumentStore.getState();
  const fresh = instruments.filter((i) => entries[i.symbol]?.status !== 'ready');
  if (fresh.length === 0) return;
  useInstrumentStore.setState((state) => {
    const next = { ...state.entries };
    for (const instrument of fresh) next[instrument.symbol] = { status: 'ready', instrument };
    return { entries: next };
  });
}

/** The instrument for `symbol`, loading it on first use. Undefined until a request starts. */
export function useInstrument(symbol: string): InstrumentEntry | undefined {
  const key = normalizeSymbol(symbol);
  useEffect(() => {
    ensureInstrument(key);
  }, [key]);
  return useInstrumentStore((state) => state.entries[key]);
}
