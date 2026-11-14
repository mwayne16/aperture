/** `GET /health`: whether the server is up and how its market data source is set up. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  marketData: {
    /** The configured provider adapter, e.g. "alpaca". */
    provider: string;
    /** The data feed the provider uses, e.g. "iex". */
    feed: string;
    /** False until the provider's credentials are set. */
    configured: boolean;
  };
}
