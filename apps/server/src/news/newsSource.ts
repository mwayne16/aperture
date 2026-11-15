import type { Article } from './newsRules.js';

export interface NewsQuery {
  /** Only articles about these symbols; all news when omitted. Crypto pairs use the app's form ("BTC/USD"). */
  symbols?: readonly string[];
  /** Oldest publish time wanted. */
  since: Date;
  /** The most articles to read; the newest come first. */
  limit: number;
}

/**
 * A news provider. An adapter maps the provider's payloads to articles and checks them at its boundary.
 * Failures reject with ProviderError.
 */
export interface NewsSource {
  /** Prefix of the source's article ids, e.g. "alpaca". */
  readonly id: string;
  fetch(query: NewsQuery): Promise<Article[]>;
}
