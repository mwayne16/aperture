# Aperture

A desktop app for **monitoring and analysing** US stocks, ETFs and crypto: a watchlist with live
prices, charts, price alerts and market news. Aperture never places orders or executes trades; Buy and
Sell on alerts are labels only.

The user interface currently runs on clearly labelled **simulated data**. The backend already serves real
market data from Alpaca (see [Market data](#market-data)); the app switches to it once it talks to the
backend (see [`stock-app-plan.md`](stock-app-plan.md)).

## Repository layout

An npm-workspaces monorepo:

| Path | What it is |
| --- | --- |
| `apps/desktop` | The Electron app: the React renderer in `src/`, the Electron main process and preload script in `electron/` |
| `apps/server` | The Fastify backend: the watchlist and alerts API on PostgreSQL (TypeORM), configuration, request validation, error handling, the market-data provider interface |
| `packages/shared` | Typed contracts shared by the app and the server, such as the API error shape |
| `compose.yaml` | PostgreSQL and Redis for local development |

## Prerequisites

- **Node.js 24** and **npm 11** (no pnpm or yarn).
- **Docker Desktop** for PostgreSQL and Redis. End users of the packaged app will not need Docker.

## Setup

```bash
npm install
```

Electron downloads its runtime during install. If `apps/desktop` can't find Electron afterwards, run the
download yourself (set `electron_config_cache` first to keep the download off a full system drive):

```bash
node node_modules/electron/install.js
```

Create your local settings file and fill it in:

```bash
cp .env.example .env
```

Replace every `<PLACEHOLDER>` in `.env` with a real value. Optional settings can be deleted instead to use
their defaults (see [Configuration](#configuration)); delete the two Alpaca lines until you have an account.
Without Alpaca keys the server still runs; only the market-data endpoints answer 503.
The server refuses to start while a placeholder is left in place and names the variable.

`.env` holds secrets (the database password, market-data API keys). It is git-ignored; never commit it.
Docker Compose and the server both read it.

## Infrastructure (PostgreSQL and Redis)

```bash
# Start infrastructure
docker compose up -d

# Check service status (both should become "healthy")
docker compose ps

# Follow infrastructure logs
docker compose logs -f

# Stop containers without deleting persistent data
docker compose down

# Delete containers and persistent volumes
# WARNING: This permanently deletes data stored in those volumes.
docker compose down -v
```

Both services listen on `127.0.0.1` only. PostgreSQL keeps the watchlist and alerts in the `postgres-data`
volume, so `docker compose down -v` deletes them. Redis holds only caches and transient state, so it keeps
nothing on disk.

## Development

```bash
# The app in Electron, with hot reload
npm run dev:electron --workspace @aperture/desktop

# The app in a browser at http://localhost:5173 (handy for quick UI work)
npm run dev --workspace @aperture/desktop

# The backend at http://127.0.0.1:4100 (try GET /health), restarting on changes
npm run dev --workspace @aperture/server
```

The backend applies pending database migrations when it starts. If PostgreSQL isn't reachable yet it retries
for about 30 seconds, then stops with the reason.

### Database migrations

The schema changes only through migrations in `apps/server/src/db/migrations`, never by syncing it to the
entities. After changing an entity, generate a migration, review it, and add its class to the list in
`apps/server/src/db/dataSource.ts`:

```bash
# Generate a migration from the difference between the entities and your database
npm run db:generate --workspace @aperture/server -- src/db/migrations/AddSomething

# Apply pending migrations, or undo the latest one
npm run db:migrate --workspace @aperture/server
npm run db:revert --workspace @aperture/server
```

Build and try the packaged app:

```bash
npm run build --workspace @aperture/desktop
npm run start --workspace @aperture/desktop

# Launch the build, check that the UI, the preload bridge and a pop-out window work, and exit
npm run smoke --workspace @aperture/desktop
```

## Checks

```bash
npm run check
```

Runs typecheck, lint, unused-code detection (knip), tests and builds for every workspace. A green check
is required before merging into `main`. Inside a workspace, `npm run check` checks only that workspace.

The server tests start their own throwaway PostgreSQL container (the image from `compose.yaml`), so **Docker
must be running**. They never touch the database in your `.env`.

## HTTP API

The backend listens on `127.0.0.1:4100`. Request and response types live in `packages/shared`. Every
error uses one shape, `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`, with
the codes `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409), `PROVIDER_ERROR` (502, the
market-data provider failed or rejected the keys), `UNAVAILABLE` (503, e.g. the database is down or market
data isn't configured) and `INTERNAL` (500). Unknown fields and query parameters are rejected.

| Method and path | Does |
| --- | --- |
| `GET /health` | Server, database and market-data status; 503 while the database is down |
| `GET /watchlist` | The watchlist: `{ symbols, updatedAt }` |
| `POST /watchlist/symbols` | Append `{ symbol }`. 409 for a duplicate, 400 once the list holds 30 symbols |
| `DELETE /watchlist/symbols/:symbol` | Remove a symbol. Encode crypto pairs: `BTC%2FUSD` |
| `PUT /watchlist/order` | Reorder with `{ symbols }`, which must list every current symbol once |
| `GET /alerts` | `{ alerts }`, oldest first |
| `POST /alerts` | Create `{ symbol, condition, targetPrice, tag, enabled?, note? }` (201) |
| `PATCH /alerts/:id` | Change any of `condition`, `targetPrice`, `tag`, `enabled`, `note`; `note: null` clears it |
| `DELETE /alerts/:id` | Delete (204) |
| `GET /instruments` | `{ instruments }` ordered by symbol; `assetClass=stock\|etf\|crypto` filters, `limit` caps |
| `GET /instruments?q=app` | Search: exact symbol, then symbol prefix, then name; 8 results by default, `limit` up to 50 |
| `GET /instruments/:symbol` | One instrument; 404 if the provider doesn't list it |
| `GET /instruments/:symbol/history?range=1M` | Chart bars for `1D`, `1W`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`, `10Y` or `ALL` |
| `GET /quotes?symbols=AAPL,BTC/USD` | `{ quotes }` in the order asked, up to 200 symbols; unknown ones are `unavailable` |
| `GET /movers?limit=5` | Today's top stock gainers, losers and most active, with quotes (`limit` up to 50) |
| `GET /market-data/status` | Each live connection's state, reconnect attempt and last error, and which symbols are polled; 200 even without keys |

Alerts are evaluated on the last trade price. Changing an alert's condition or target price, or enabling
it again, re-arms it so it can fire again.

## Configuration

The server validates its settings at startup and stops with a list of problems if any are invalid. The
messages name the variable and never print its value.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `SERVER_HOST` | `127.0.0.1` | Address the API binds to; keep loopback unless you need network access |
| `SERVER_PORT` | `4100` | API port |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATABASE_URL` | required | PostgreSQL connection URL |
| `REDIS_URL` | required | Redis connection URL |
| `MARKET_DATA_PROVIDER` | `alpaca` | Which market-data adapter to use |
| `ALPACA_DATA_FEED` | `iex` | `iex` (free, IEX exchange only), `sip` (all exchanges, paid) or `delayed_sip` |
| `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | unset | Alpaca **paper-trading** keys; set both or neither |
| `POSTGRES_USER`, `POSTGRES_DB` | `aperture` | Database account and name Docker Compose creates |
| `POSTGRES_PASSWORD` | required | Password for that account; Docker Compose won't start without it |
| `POSTGRES_PORT`, `REDIS_PORT` | `5432`, `6379` | Host ports for Docker Compose |

## Security notes

- The renderer runs sandboxed with context isolation and no Node.js access. It reaches the desktop only
  through a small typed preload bridge, may only show the app itself, and opens web links in the system
  browser. The packaged app sets a strict Content Security Policy.
- API keys live only in the server's environment. They never reach the renderer, and the server's logs
  redact them.

## Market data

Market data sits behind a provider interface (`apps/server/src/marketData/provider.ts`). Alpaca is the
first adapter; another source means a new adapter and a change to `MARKET_DATA_PROVIDER`.

Alpaca's free plan allows 200 REST calls a minute, one stream connection and 30 live symbols per
stream, with real-time prices from the IEX exchange only. Aperture caps the watchlist at 30 symbols so
a full watchlist still streams live, and labels IEX prices as such rather than as consolidated prices.

To connect Alpaca, create a free account at alpaca.markets, open the **paper-trading** dashboard, generate
API keys and put them in `.env` as `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`. Paper keys read the same
market data as live ones and can never touch real money. The server reads the instrument list from
Alpaca's paper-trading host, so it needs paper keys. It uses only Alpaca's market-data and read-only asset
APIs and never calls the trading API.

How the server uses the free plan:

- It throttles itself to 180 requests a minute and retries rate-limited or failed reads twice with backoff.
  Quotes for many symbols, and bars for many symbols, each take one request.
- The instrument list is cached for a day, chart history for a minute (intraday ranges) or 15 minutes
  (daily and longer), and movers for a minute. The caches live in memory and hold a bounded number of
  entries.
- With `ALPACA_DATA_FEED=delayed_sip`, quotes come 15 minutes late and are marked `delayed`, and chart
  history comes from SIP and ends 15 minutes ago, which the free plan allows.
- Alpaca has no fund flag, so ETFs are recognized by name ("ETF", "ETN" or "Trust, Series"). A fund whose
  name has none of these shows as a stock. OTC listings are left out because the IEX feed has no prices
  for them.
- Alpaca provides no fundamentals (market cap, P/E, EPS), so Aperture doesn't show them.

Live prices:

- The server keeps one stream connection for stocks and ETFs and one for crypto, each opened when it first
  has symbols. The watchlist always streams (it holds at most 30 symbols, the per-connection limit); spare
  room goes to symbols of enabled alerts. Once the app talks to the server over its live connection, an open
  stock page will get spare room ahead of alerts.
- Symbols that don't fit, or whose connection is down, are polled: one batched snapshot request every 15
  seconds. Streamed symbols also get a snapshot once a minute for the day's volume, range and previous close.
- A symbol counts as streamed only after Alpaca confirms the subscription; anything Alpaca refuses stays
  polled. `/quotes` serves current live values directly and fetches the rest.
- After a drop, a connection retries 10 times with backoff (1 s doubling to 64 s). If it still can't connect,
  for example because another app holds the one connection the plan allows, the server tries again every five
  minutes. Rejected keys aren't retried until you fix them and restart. `GET /market-data/status` explains
  each case in plain words.
