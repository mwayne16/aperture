import type { AssetClass, Instrument } from '../../domain/types';

/**
 * The simulated instrument universe. Names and exchanges are real listings; every number here
 * (reference price, volatility, volume) is a SIMULATED reference value used to drive the mock feed,
 * not market data.
 */
export interface InstrumentProfile extends Instrument {
  /** Simulated reference price in USD that the model's previous close is drawn around. */
  referencePrice: number;
  /** Relative volatility: 1 is a typical large-cap stock, 0.5 a calm ETF, 2+ a high-beta name. */
  volatility: number;
  /** Simulated average daily volume in shares, or in coins for crypto. */
  averageVolume: number;
  /** Year of listing. History before Jan 1 of this year is not available. */
  listedYear: number;
}

type Row = [
  symbol: string,
  name: string,
  exchange: string,
  referencePrice: number,
  volatility: number,
  averageVolume: number,
  listedYear: number,
];

const STOCKS: Row[] = [
  ['AAPL', 'Apple Inc.', 'NASDAQ', 232.5, 1.0, 55_000_000, 1980],
  ['MSFT', 'Microsoft Corporation', 'NASDAQ', 468.2, 0.9, 22_000_000, 1986],
  ['NVDA', 'NVIDIA Corporation', 'NASDAQ', 181.4, 1.8, 240_000_000, 1999],
  ['GOOGL', 'Alphabet Inc. Class A', 'NASDAQ', 192.8, 1.1, 30_000_000, 2004],
  ['AMZN', 'Amazon.com, Inc.', 'NASDAQ', 214.6, 1.2, 45_000_000, 1997],
  ['META', 'Meta Platforms, Inc. Class A', 'NASDAQ', 688.9, 1.3, 15_000_000, 2012],
  ['TSLA', 'Tesla, Inc.', 'NASDAQ', 328.7, 2.2, 100_000_000, 2010],
  ['AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ', 158.3, 1.9, 50_000_000, 1972],
  ['AVGO', 'Broadcom Inc.', 'NASDAQ', 302.1, 1.6, 25_000_000, 2009],
  ['NFLX', 'Netflix, Inc.', 'NASDAQ', 1148.0, 1.4, 4_000_000, 2002],
  ['JPM', 'JPMorgan Chase & Co.', 'NYSE', 281.6, 0.9, 9_000_000, 1969],
  ['BAC', 'Bank of America Corporation', 'NYSE', 46.2, 1.0, 38_000_000, 1973],
  ['GS', 'The Goldman Sachs Group, Inc.', 'NYSE', 692.4, 1.1, 2_200_000, 1999],
  ['MS', 'Morgan Stanley', 'NYSE', 134.9, 1.1, 6_000_000, 1993],
  ['V', 'Visa Inc. Class A', 'NYSE', 344.7, 0.7, 7_000_000, 2008],
  ['MA', 'Mastercard Incorporated Class A', 'NYSE', 561.3, 0.8, 3_000_000, 2006],
  ['BRK.B', 'Berkshire Hathaway Inc. Class B', 'NYSE', 488.5, 0.6, 4_000_000, 1996],
  ['XOM', 'Exxon Mobil Corporation', 'NYSE', 111.8, 0.9, 15_000_000, 1920],
  ['CVX', 'Chevron Corporation', 'NYSE', 154.6, 0.9, 8_000_000, 1921],
  ['JNJ', 'Johnson & Johnson', 'NYSE', 156.3, 0.6, 8_000_000, 1944],
  ['UNH', 'UnitedHealth Group Incorporated', 'NYSE', 309.4, 1.2, 9_000_000, 1984],
  ['PFE', 'Pfizer Inc.', 'NYSE', 25.1, 0.8, 40_000_000, 1942],
  ['LLY', 'Eli Lilly and Company', 'NYSE', 781.2, 1.2, 4_000_000, 1970],
  ['MRK', 'Merck & Co., Inc.', 'NYSE', 84.7, 0.8, 12_000_000, 1946],
  ['ABBV', 'AbbVie Inc.', 'NYSE', 191.5, 0.8, 6_000_000, 2013],
  ['KO', 'The Coca-Cola Company', 'NYSE', 69.8, 0.5, 14_000_000, 1919],
  ['PEP', 'PepsiCo, Inc.', 'NASDAQ', 144.2, 0.6, 7_000_000, 1919],
  ['WMT', 'Walmart Inc.', 'NYSE', 97.9, 0.6, 18_000_000, 1972],
  ['COST', 'Costco Wholesale Corporation', 'NASDAQ', 938.4, 0.8, 2_000_000, 1985],
  ['HD', 'The Home Depot, Inc.', 'NYSE', 381.7, 0.8, 3_500_000, 1981],
  ['MCD', "McDonald's Corporation", 'NYSE', 298.6, 0.6, 3_200_000, 1965],
  ['NKE', 'NIKE, Inc. Class B', 'NYSE', 74.3, 1.1, 11_000_000, 1980],
  ['SBUX', 'Starbucks Corporation', 'NASDAQ', 89.5, 1.0, 9_000_000, 1992],
  ['DIS', 'The Walt Disney Company', 'NYSE', 114.8, 1.0, 9_000_000, 1957],
  ['BA', 'The Boeing Company', 'NYSE', 214.2, 1.4, 8_000_000, 1962],
  ['CAT', 'Caterpillar Inc.', 'NYSE', 401.3, 1.1, 2_800_000, 1929],
  ['F', 'Ford Motor Company', 'NYSE', 11.4, 1.1, 50_000_000, 1956],
  ['T', 'AT&T Inc.', 'NYSE', 27.3, 0.6, 32_000_000, 1983],
  ['VZ', 'Verizon Communications Inc.', 'NYSE', 43.1, 0.6, 17_000_000, 1983],
  ['INTC', 'Intel Corporation', 'NASDAQ', 24.2, 1.6, 90_000_000, 1971],
  ['ORCL', 'Oracle Corporation', 'NYSE', 231.4, 1.4, 12_000_000, 1986],
  ['CRM', 'Salesforce, Inc.', 'NYSE', 254.9, 1.2, 7_000_000, 2004],
  ['ADBE', 'Adobe Inc.', 'NASDAQ', 361.2, 1.1, 3_500_000, 1986],
  ['CSCO', 'Cisco Systems, Inc.', 'NASDAQ', 68.4, 0.7, 20_000_000, 1990],
  ['IBM', 'International Business Machines Corporation', 'NYSE', 259.7, 0.8, 4_500_000, 1915],
  ['QCOM', 'QUALCOMM Incorporated', 'NASDAQ', 159.6, 1.3, 8_000_000, 1991],
  ['TXN', 'Texas Instruments Incorporated', 'NASDAQ', 189.3, 1.0, 6_000_000, 1953],
  ['MU', 'Micron Technology, Inc.', 'NASDAQ', 124.8, 1.8, 22_000_000, 1984],
  ['PYPL', 'PayPal Holdings, Inc.', 'NASDAQ', 69.7, 1.3, 14_000_000, 2015],
  ['UBER', 'Uber Technologies, Inc.', 'NYSE', 89.6, 1.4, 18_000_000, 2019],
  ['ABNB', 'Airbnb, Inc. Class A', 'NASDAQ', 129.4, 1.4, 5_000_000, 2020],
  ['SHOP', 'Shopify Inc. Class A', 'NASDAQ', 114.7, 1.8, 9_000_000, 2015],
  ['PLTR', 'Palantir Technologies Inc. Class A', 'NASDAQ', 151.2, 2.2, 75_000_000, 2020],
  ['COIN', 'Coinbase Global, Inc. Class A', 'NASDAQ', 318.6, 2.4, 9_000_000, 2021],
];

const ETFS: Row[] = [
  ['SPY', 'SPDR S&P 500 ETF Trust', 'NYSE Arca', 601.3, 0.5, 65_000_000, 1993],
  ['QQQ', 'Invesco QQQ Trust, Series 1', 'NASDAQ', 528.7, 0.65, 40_000_000, 1999],
  ['IWM', 'iShares Russell 2000 ETF', 'NYSE Arca', 224.6, 0.8, 30_000_000, 2000],
  ['DIA', 'SPDR Dow Jones Industrial Average ETF Trust', 'NYSE Arca', 441.8, 0.5, 3_500_000, 1998],
  ['VTI', 'Vanguard Total Stock Market ETF', 'NYSE Arca', 298.4, 0.5, 4_000_000, 2001],
  ['XLK', 'Technology Select Sector SPDR Fund', 'NYSE Arca', 251.2, 0.7, 7_000_000, 1998],
  ['XLF', 'Financial Select Sector SPDR Fund', 'NYSE Arca', 52.3, 0.6, 40_000_000, 1998],
  ['XLE', 'Energy Select Sector SPDR Fund', 'NYSE Arca', 88.4, 0.8, 15_000_000, 1998],
  ['XLV', 'Health Care Select Sector SPDR Fund', 'NYSE Arca', 139.7, 0.5, 8_000_000, 1998],
  ['GLD', 'SPDR Gold Shares', 'NYSE Arca', 309.8, 0.6, 9_000_000, 2004],
  ['TLT', 'iShares 20+ Year Treasury Bond ETF', 'NASDAQ', 88.2, 0.5, 35_000_000, 2002],
  ['ARKK', 'ARK Innovation ETF', 'NYSE Arca', 69.9, 1.8, 10_000_000, 2014],
];

// ** Crypto history starts in 2021, when Alpaca's crypto market data begins.
const CRYPTO: Row[] = [
  ['BTC/USD', 'Bitcoin', 'CRYPTO', 68_400, 2.0, 28_000, 2021],
  ['ETH/USD', 'Ethereum', 'CRYPTO', 3_420, 2.4, 310_000, 2021],
  ['SOL/USD', 'Solana', 'CRYPTO', 172.5, 3.0, 2_100_000, 2021],
  ['XRP/USD', 'XRP', 'CRYPTO', 2.31, 2.8, 95_000_000, 2021],
  ['ADA/USD', 'Cardano', 'CRYPTO', 0.712, 2.9, 120_000_000, 2021],
  ['AVAX/USD', 'Avalanche', 'CRYPTO', 34.8, 3.0, 3_500_000, 2021],
  ['LINK/USD', 'Chainlink', 'CRYPTO', 17.6, 2.9, 6_000_000, 2021],
  ['DOT/USD', 'Polkadot', 'CRYPTO', 6.92, 3.0, 9_000_000, 2021],
  ['LTC/USD', 'Litecoin', 'CRYPTO', 98.4, 2.5, 1_200_000, 2021],
  ['DOGE/USD', 'Dogecoin', 'CRYPTO', 0.1834, 3.0, 900_000_000, 2021],
];

function toProfile(assetClass: AssetClass) {
  return ([
    symbol,
    name,
    exchange,
    referencePrice,
    volatility,
    averageVolume,
    listedYear,
  ]: Row): InstrumentProfile =>
    Object.freeze({ symbol, name, exchange, assetClass, referencePrice, volatility, averageVolume, listedYear });
}

export const INSTRUMENTS: readonly InstrumentProfile[] = Object.freeze([
  ...STOCKS.map(toProfile('stock')),
  ...ETFS.map(toProfile('etf')),
  ...CRYPTO.map(toProfile('crypto')),
]);

const BY_SYMBOL: ReadonlyMap<string, InstrumentProfile> = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

/** Profile for a normalized symbol, or undefined when it is not in the simulated universe. */
export function findInstrument(symbol: string): InstrumentProfile | undefined {
  return BY_SYMBOL.get(symbol);
}

/** Public shape (no simulation parameters). */
export function toInstrument(profile: InstrumentProfile): Instrument {
  return { symbol: profile.symbol, name: profile.name, exchange: profile.exchange, assetClass: profile.assetClass };
}
