import { useSubscribedSymbols } from '../../app/useQuoteSubscriptions';
import { useQuoteStore } from '../../data/quoteStore';
import { quoteFreshness, type QuoteFreshness } from './connectionStatus';

interface FeedStatus {
  /** The symbols the app keeps subscribed. */
  symbols: readonly string[];
  freshness: QuoteFreshness;
}

/**
 * The subscribed symbols and the freshness of their quotes. Symbols the app no longer watches are
 * left out, since their last quote keeps whatever status it had when the subscription ended.
 */
export function useFeedStatus(): FeedStatus {
  const symbols = useSubscribedSymbols();
  const freshness = useQuoteStore((state) =>
    quoteFreshness(symbols.map((symbol) => state.quotes[symbol]?.status)),
  );
  return { symbols, freshness };
}
