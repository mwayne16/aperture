# Aperture

A desktop app for **monitoring and analysing** US stocks, ETFs and crypto: a watchlist with live
prices, charts, price alerts and market news. Aperture never places orders or executes trades; Buy and
Sell on alerts are labels only.

The user interface currently runs on clearly labelled **simulated data**. Real market data arrives with
the market-data integration (see [`stock-app-plan.md`](stock-app-plan.md)).

## Repository layout

An npm-workspaces monorepo:

| Path | What it is |
| --- | --- |
| `apps/desktop` | The Electron app: the React renderer in `src/`, the Electron main process and preload script in `electron/` |
| `apps/server` | The Fastify backend: configuration, request validation, error handling, the market-data provider interface |
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

Both services listen on `127.0.0.1` only. PostgreSQL keeps its data in the `postgres-data` volume;
Redis holds only caches and transient state, so it keeps nothing on disk.

## Development

```bash
# The app in Electron, with hot reload
npm run dev:electron --workspace @aperture/desktop

# The app in a browser at http://localhost:5173 (handy for quick UI work)
npm run dev --workspace @aperture/desktop

# The backend at http://127.0.0.1:4100 (try GET /health), restarting on changes
npm run dev --workspace @aperture/server
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
| `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | unset | Alpaca credentials; set both or neither |
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
