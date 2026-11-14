import { useEffect, useState } from 'react';
import { api } from '../../data/dataLayer';
import type { AssetClass, Instrument } from '../../domain/types';

/**
 * The instruments of each asset class, loaded once per session: the universe changes far less often
 * than a session lasts. Concurrent loads share one request, and a failure is not kept, so the next
 * load tries again.
 */

const ASSET_CLASSES: readonly AssetClass[] = ['stock', 'etf', 'crypto'];

type InstrumentList = readonly Instrument[];

interface InstrumentCatalog {
  peek(assetClass: AssetClass): InstrumentList | undefined;
  load(assetClass: AssetClass): Promise<InstrumentList>;
  /** Forgets every list (tests, demo reset). */
  clear(): void;
}

function createInstrumentCatalog(
  list: (assetClass: AssetClass) => Promise<InstrumentList>,
): InstrumentCatalog {
  const lists = new Map<AssetClass, InstrumentList>();
  const pending = new Map<AssetClass, Promise<InstrumentList>>();
  let generation = 0;

  return {
    peek: (assetClass) => lists.get(assetClass),

    load(assetClass) {
      const cached = lists.get(assetClass);
      if (cached) return Promise.resolve(cached);
      const inFlight = pending.get(assetClass);
      if (inFlight) return inFlight;
      const startedIn = generation;
      const request = list(assetClass).then(
        (instruments) => {
          if (startedIn !== generation) return instruments;
          pending.delete(assetClass);
          lists.set(assetClass, instruments);
          return instruments;
        },
        (error: unknown) => {
          if (startedIn === generation) pending.delete(assetClass);
          throw error;
        },
      );
      pending.set(assetClass, request);
      return request;
    },

    clear() {
      generation += 1;
      lists.clear();
      pending.clear();
    },
  };
}

export const instrumentCatalog = createInstrumentCatalog((assetClass) => api.listInstruments(assetClass));

function directoryOfLoaded(): ReadonlyMap<string, Instrument> {
  const directory = new Map<string, Instrument>();
  for (const assetClass of ASSET_CLASSES) {
    for (const instrument of instrumentCatalog.peek(assetClass) ?? [])
      directory.set(instrument.symbol, instrument);
  }
  return directory;
}

/**
 * Every known instrument by symbol, for labelling symbols with their names. Starts with what is
 * already loaded and fills in as the other asset classes arrive. Failures leave names out; they are
 * a nicety, never a reason to show an error.
 */
export function useInstrumentDirectory(): ReadonlyMap<string, Instrument> {
  const [directory, setDirectory] = useState(directoryOfLoaded);
  useEffect(() => {
    let active = true;
    for (const assetClass of ASSET_CLASSES) {
      if (instrumentCatalog.peek(assetClass)) continue;
      instrumentCatalog.load(assetClass).then(
        () => {
          if (active) setDirectory(directoryOfLoaded());
        },
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, []);
  return directory;
}
