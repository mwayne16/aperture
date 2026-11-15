/** One news story as the API sends it. */
export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  /** Symbols the article is about. */
  symbols: string[];
  /** ISO timestamp. */
  publishedAt: string;
  /** Link to the full article, or null when there is none (simulated items). */
  url: string | null;
  /** True for prototype headlines. The UI must label them as simulated. */
  simulated: boolean;
  /** Why the story is in the feed, e.g. "About AAPL" or "Top market story". Shown next to it. */
  reason: string;
}

/** `GET /news`: stories in the order to show them. */
export interface NewsList {
  news: NewsItem[];
}

/** Stories a request may ask for; the dashboard shows 5 and expands to 25. */
export const MAX_NEWS_LIMIT = 25;
export const DEFAULT_NEWS_LIMIT = 10;
