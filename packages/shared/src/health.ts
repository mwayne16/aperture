/**
 * `GET /health`: whether the server can serve requests and how its market data source is set up.
 * Answered with status 200 when the database is reachable and 503 when it isn't.
 */
export interface HealthResponse {
  status: 'ok' | 'unavailable';
  version: string;
  uptimeSeconds: number;
  database: 'up' | 'down';
  /** Information only: Redis holds caches, so the server serves requests without it. */
  redis: 'up' | 'down';
  marketData: {
    /** The configured provider adapter, e.g. "alpaca". */
    provider: string;
    /** The data feed the provider uses, e.g. "iex". */
    feed: string;
    /** False until the provider's credentials are set. */
    configured: boolean;
  };
}
