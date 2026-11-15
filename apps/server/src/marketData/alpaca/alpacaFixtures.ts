/**
 * Alpaca response bodies for the adapter tests. Their shapes follow Alpaca's API reference and the field
 * names the SDK's generated parsers read; the values are made up. They are not recordings of real
 * responses, so the adapter still needs a check against Alpaca itself once API keys exist.
 */

export const ASSETS_US_EQUITY = [
  {
    id: 'b0b6dd9d-8b9b-48a9-ba46-b9d54906e415',
    class: 'us_equity',
    exchange: 'NASDAQ',
    symbol: 'AAPL',
    name: 'Apple Inc. Common Stock',
    status: 'active',
    tradable: true,
    marginable: true,
    shortable: true,
    easy_to_borrow: true,
    fractionable: true,
    attributes: ['has_options'],
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000001',
    class: 'us_equity',
    exchange: 'ARCA',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    status: 'active',
    tradable: true,
    marginable: true,
    shortable: true,
    easy_to_borrow: true,
    fractionable: true,
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000002',
    class: 'us_equity',
    exchange: 'NASDAQ',
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust, Series 1',
    status: 'active',
    tradable: true,
    marginable: true,
    shortable: true,
    easy_to_borrow: true,
    fractionable: true,
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000003',
    class: 'us_equity',
    exchange: 'NYSE',
    symbol: 'BRK.B',
    name: 'Berkshire Hathaway Inc. Class B',
    status: 'active',
    tradable: true,
    marginable: true,
    shortable: true,
    easy_to_borrow: true,
    fractionable: true,
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000004',
    class: 'us_equity',
    exchange: 'OTC',
    symbol: 'GBTC',
    name: 'An OTC listing',
    status: 'active',
    tradable: true,
    marginable: false,
    shortable: false,
    easy_to_borrow: false,
    fractionable: false,
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000005',
    class: 'us_equity',
    exchange: 'NYSE',
    symbol: 'HALT',
    name: 'Not tradable',
    status: 'active',
    tradable: false,
    marginable: false,
    shortable: false,
    easy_to_borrow: false,
    fractionable: false,
  },
  {
    id: '6b71d7e3-0000-4000-8000-000000000006',
    class: 'us_equity',
    exchange: 'NYSE',
    symbol: 'BAD SYMBOL',
    name: 'A symbol the shared rules reject',
    status: 'active',
    tradable: true,
    marginable: false,
    shortable: false,
    easy_to_borrow: false,
    fractionable: false,
  },
];

export const ASSETS_CRYPTO = [
  {
    id: '276e2673-764b-4ab6-a611-caf665ca6340',
    class: 'crypto',
    exchange: 'CRYPTO',
    symbol: 'BTC/USD',
    name: 'Bitcoin  / US Dollar',
    status: 'active',
    tradable: true,
    marginable: false,
    shortable: false,
    easy_to_borrow: false,
    fractionable: true,
  },
];

/** `GET /v2/stocks/snapshots`: a map of symbol to snapshot. */
export const STOCK_SNAPSHOTS = {
  AAPL: {
    latestTrade: {
      t: '2026-11-13T20:59:58.123456789Z',
      x: 'V',
      p: 228.5,
      s: 100,
      c: ['@'],
      i: 52983525029461,
      z: 'C',
    },
    latestQuote: {
      t: '2026-11-13T20:59:59.5Z',
      ax: 'V',
      ap: 228.55,
      as: 2,
      bx: 'V',
      bp: 228.45,
      bs: 3,
      c: ['R'],
      z: 'C',
    },
    minuteBar: {
      t: '2026-11-13T20:59:00Z',
      o: 228.4,
      h: 228.6,
      l: 228.3,
      c: 228.5,
      v: 1200,
      n: 40,
      vw: 228.47,
    },
    dailyBar: {
      t: '2026-11-13T05:00:00Z',
      o: 225.1,
      h: 229.2,
      l: 224.8,
      c: 228.5,
      v: 1_850_000,
      n: 25_000,
      vw: 227.9,
    },
    prevDailyBar: {
      t: '2026-11-12T05:00:00Z',
      o: 223,
      h: 226,
      l: 222.5,
      c: 225,
      v: 1_700_000,
      n: 24_000,
      vw: 224.6,
    },
  },
  MSFT: {
    latestTrade: { t: 'not a date', x: 'V', p: 'NaN', s: 5, c: [], i: 1, z: 'C' },
    latestQuote: { t: '2026-11-13T20:59:59Z', ax: 'V', ap: 0, as: 0, bx: 'V', bp: 0, bs: 0, c: [], z: 'C' },
    dailyBar: { t: '2026-11-13T05:00:00Z', o: -1, h: 510, l: 500, c: 505, v: -5, n: 10, vw: 505 },
  },
};

/** `GET /v1beta3/crypto/us/snapshots`: snapshots under a `snapshots` key. */
export const CRYPTO_SNAPSHOTS = {
  snapshots: {
    'BTC/USD': {
      latestTrade: { t: '2026-11-14T12:00:01Z', p: 91_250.5, s: 0.0125, tks: 'B', i: 12345 },
      latestQuote: { t: '2026-11-14T12:00:02Z', bp: 91_240, bs: 0.4, ap: 91_260, as: 0.35 },
      dailyBar: {
        t: '2026-11-14T00:00:00Z',
        o: 90_100,
        h: 91_900,
        l: 89_800,
        c: 91_250.5,
        v: 812.5,
        n: 9_000,
        vw: 90_900,
      },
      prevDailyBar: {
        t: '2026-11-13T00:00:00Z',
        o: 89_000,
        h: 90_500,
        l: 88_700,
        c: 90_100,
        v: 900.1,
        n: 9_500,
        vw: 89_800,
      },
    },
  },
};

/** `GET /v2/stocks/bars`, first page: bars per symbol with a token for the next page. */
export const STOCK_BARS_PAGE_1 = {
  bars: {
    AAPL: [
      { t: '2026-11-11T05:00:00Z', o: 220, h: 224, l: 219, c: 223, v: 1_500_000, n: 20_000, vw: 222 },
      { t: '2026-11-12T05:00:00Z', o: 223, h: 226, l: 222.5, c: 225, v: 1_700_000, n: 24_000, vw: 224.6 },
    ],
  },
  next_page_token: 'QUFQTHxEfDIwMjYtMTEtMTI=',
};

/** `GET /v2/stocks/bars`, last page, including one malformed bar the adapter must drop. */
export const STOCK_BARS_PAGE_2 = {
  bars: {
    AAPL: [
      {
        t: '2026-11-13T05:00:00Z',
        o: 225.1,
        h: 229.2,
        l: 224.8,
        c: 228.5,
        v: 1_850_000,
        n: 25_000,
        vw: 227.9,
      },
      { t: '2026-11-14T05:00:00Z', o: 0, h: 1, l: 1, c: 1, v: 1, n: 1, vw: 1 },
    ],
  },
  next_page_token: null,
};

export const CRYPTO_BARS = {
  bars: {
    'BTC/USD': [
      {
        t: '2026-11-13T00:00:00Z',
        o: 89_000,
        h: 90_500,
        l: 88_700,
        c: 90_100,
        v: 900.1,
        n: 9_500,
        vw: 89_800,
      },
    ],
  },
  next_page_token: null,
};

/** `GET /v1beta1/screener/stocks/movers`. */
export const MOVERS = {
  gainers: [
    { symbol: 'NVDA', percent_change: 6.2, change: 9.1, price: 155.9 },
    { symbol: 'not valid!', percent_change: 5.5, change: 1, price: 19 },
  ],
  losers: [{ symbol: 'TSLA', percent_change: -4.1, change: -14.2, price: 331.8 }],
  market_type: 'stocks',
  last_updated: '2026-11-13T20:59:00.123Z',
};

/** `GET /v1beta1/screener/stocks/most-actives`. */
export const MOST_ACTIVES = {
  most_actives: [
    { symbol: 'AAPL', volume: 51_000_000, trade_count: 620_000 },
    { symbol: 'NVDA', volume: 48_000_000, trade_count: 700_000 },
  ],
  last_updated: '2026-11-13T20:59:00.123Z',
};

/** `GET /v1beta1/news`, first page. */
export const NEWS_PAGE_1 = {
  news: [
    {
      id: 41_000_002,
      headline: 'Apple Q4 results top revenue estimates',
      author: 'Benzinga Newsdesk',
      created_at: '2026-11-16T14:30:00Z',
      updated_at: '2026-11-16T14:31:00Z',
      summary: 'Apple reported fourth-quarter revenue above estimates.',
      url: 'https://www.benzinga.com/news/26/11/41000002/apple-q4',
      images: [],
      symbols: ['AAPL', 'not a symbol!'],
      source: 'benzinga',
    },
    {
      id: 41_000_001,
      headline: 'Bitcoin tops 90,000',
      author: 'Benzinga Newsdesk',
      created_at: '2026-11-16T13:00:00Z',
      updated_at: '2026-11-16T13:00:00Z',
      summary: '',
      url: 'javascript:alert(1)',
      images: [],
      symbols: ['BTCUSD'],
      source: 'benzinga',
    },
  ],
  next_page_token: 'NDEwMDAwMDA=',
};

/** `GET /v1beta1/news`, last page, with an article that has no headline. */
export const NEWS_PAGE_2 = {
  news: [
    {
      id: 41_000_000,
      headline: '',
      author: '',
      created_at: '2026-11-16T12:00:00Z',
      updated_at: '2026-11-16T12:00:00Z',
      summary: '',
      url: '',
      images: [],
      symbols: [],
      source: 'benzinga',
    },
  ],
  next_page_token: null,
};
