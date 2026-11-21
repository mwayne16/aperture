# Aperture — Desktop Stock Monitoring & Analysis

Electron + React desktop app with a Fastify backend for market **monitoring and analysis only**.
It must never place orders or execute trades. Buy/Sell on alerts are user labels, nothing more.
The full spec is `stock-app-plan.md`. Read it before you change architecture.

## Current phase
- Phase 0 (interactive prototype): **approved by the user on 2026-11-13.** It includes the multi-page
  redesign, the visual polish pass (tag `before-ui-polish` marks the state before it) and the news card.
  Watchlist-curated news ranking is specified in plan section 2.6 for later.
- Phase 1 (project foundation): **merged 2026-11-14.** Workspaces, the hardened Electron shell, the Fastify
  server (config, validation pipeline, errors, health), shared contracts, Docker Compose and the README.
- Phase 2 (persistence and API): **merged 2026-11-14.** Schema and the first migration, watchlist and alert
  endpoints, DB-unavailable handling, Testcontainers-backed tests, and a manual check that data survives a
  backend restart.
- Phase 3 (market data integration): **merged 2026-11-15**, apart from a second news source.
  (1) REST market data (the Alpaca adapter, instruments and search, quote snapshots, chart history, movers):
  PR #5. (2) Live prices: one Alpaca connection per channel, the 30-symbol budget, connection status
  (`GET /market-data/status`), polling for the rest: PR #6. (3) The curated news feed (plan section 2.6)
  with the Redis cache: PR #7. Alpaca news only for now (user's choice, 2026-11-15); a second source waits
  for the user to pick a provider. The `reason` tag isn't shown in the UI yet (frontend integration).
  Verified against real Alpaca on 2026-11-21 with the user's paper keys (Friday evening, stocks closed):
  about 12,900 instruments with correct ETF classification, search, stock and crypto snapshots (unknown
  symbols in a batch come back unavailable without failing it), history for every range, the screener
  (on the free plan), news, the crypto stream (connects, confirms subscriptions, ticks reach `/realtime`),
  and a BTC/USD alert that fired once on the next real trade and didn't repeat. No log line held the keys.
  Not yet seen with real data: stock ticks during market hours, and whether trades plus quotes for 30
  symbols fit the stream's cap. The check found four problems, fixed on `fix/live-data-findings`: movers
  full of warrants and stale prices, history floors, quotes "live" after the close, and crypto news (none).
- Phase 4 (real-time updates and alerting): **in progress, split into three PRs.**
  (1) Server-side alert evaluation with the trigger history table and `GET /alerts/events`: **merged
  2026-11-20** (PR #8). (2) The realtime WebSocket (`/realtime`): typed contracts, coalesced quote batches,
  status, alert events, validated messages, focus and viewed symbols in live demand, recovery by snapshot
  on subscribe: built 2026-11-20 on `feat/realtime-socket`. The app's client for it comes with frontend
  integration. (3) Native desktop notifications through the Electron bridge: next.
- Track phase status in this section. Update it whenever a phase is approved or completed.

## Product decisions that override the plan
- 2026-11-13: **one watchlist per user.** The plan's section 2.2 asks for several named watchlists; the user
  found that overcomplicated. Users add any stock, ETF or crypto pair to their single watchlist; there is
  no create, rename, delete or switching of lists. The API has `getWatchlist`, `addSymbol`, `removeSymbol`
  and `reorderSymbols` without ids, and the backend stores one watchlist per user.
- 2026-11-14: **the watchlist holds at most 30 symbols**, the free Alpaca plan's live-stream symbol limit, so
  a full watchlist still streams live. Symbols outside it that need prices (alerts on unwatched symbols,
  an open stock page) fall back to polled snapshots once the 30 stream slots are taken.

## Machine constraints (Windows, low C: drive)
- C: has very little free space. Everything heavy lives on D:.
  - The npm cache is set at user level to `D:\dev-cache\npm`. Don't change it.
  - Electron download cache is `D:\dev-cache\electron`. Set `electron_config_cache` to it before installing electron.
  - electron-builder cache is `D:\dev-cache\electron-builder` (`ELECTRON_BUILDER_CACHE`).
  - Playwright browsers go in `D:\dev-cache\playwright` (`PLAYWRIGHT_BROWSERS_PATH`).
  - Docker Desktop data is already on `D:\Docker\WSL`.
- Shells: use the Bash tool (Git Bash) for POSIX commands. Paths look like `/d/repositories/aperture-client`.
- Package manager: **npm** (no pnpm or yarn here). Node 24, npm 11.
- GitHub CLI lives at `D:\Tools\GitHub CLI\gh.exe` (`"/d/Tools/GitHub CLI/gh.exe"` in Bash if `gh` isn't on PATH yet).
  Logged in as `mwayne16` with `repo` + `workflow` scopes.

## Repository
- Remote: https://github.com/mwayne16/aperture (private). The local folder is still named `aperture-client`.
- **Monorepo** with npm workspaces from Phase 1: `apps/desktop` (Electron + React), `apps/server` (Fastify),
  `packages/shared` (typed HTTP/WebSocket contracts). Chosen so client and API share types and change atomically.
- `main` is protected on GitHub (2026-11-14): merging needs the CI check "Typecheck, lint, knip, test and build
  (all workspaces)" to pass. Branch protection matches that job name exactly, so don't rename or split the job.
  Work happens on `feat/*` branches. PRs so far merged by rebase once CI passed, each at the user's request;
  ask before opening, auto-merging or merging a PR.
- Ports: desktop renderer dev server 5173, server API 4100, Postgres 5432, Redis 6379 (all on 127.0.0.1).
- One `.env` at the repo root (from `.env.example`) feeds Docker Compose and the server
  (`node --env-file-if-exists=../../.env`). No dotenv package.

## Toolchain decisions (don't revisit without a reason written down here)
- TypeScript is pinned to **~6.0.3** everywhere. Verified 2026-10-23: TS 6.0.3 compiles a TypeORM 1.1.2
  entity plus class-validator/class-transformer DTOs with `experimentalDecorators` + `emitDecoratorMetadata`,
  emits `design:type`, and needs no deprecation flags. TS 7 is blocked because typescript-eslint peers on `<6.1.0`.
  TS 6 defaults to `types: []`, so list needed types (`node`, `vite/client`) explicitly in each tsconfig.
- Before pinning anything below its latest major, prove the incompatibility with a real install and
  compile, and write the evidence here.
- Vite 8, React 19, Vitest 5, ESLint 10 flat config with typescript-eslint strict type-checked rules.
- Charts: `lightweight-charts` v5 (TradingView, Apache-2.0).
- Market data: Alpaca **free plan, IEX feed** (decided 2026-11-07; the user made a paper account 2026-11-20,
  and its keys are in `.env`).
  IEX quotes and trades are real-time but cover only the IEX exchange, so label them "IEX" and never as
  consolidated prices or volume. Alpaca provides no fundamentals (market cap, P/E, EPS): don't show them
  unless another source is added. Free-plan limits the backend must respect (checked 2026-11-14):
  - 200 REST calls/min: batch with multi-symbol endpoints (snapshots, bars), cache, and rate-limit below 200
    with backoff on 429. Never fetch history or sparklines one symbol per request.
  - Streams: 1 connection per endpoint (a second client on the same keys gets 406) and 30 symbols per
    stream; the 30-symbol cap applies to the crypto stream too. Budget slots by priority: watchlist rows
    (always fit, see the 30-symbol decision), then the open symbol page, then enabled alerts; poll the rest.
  - REST requests can't reach the latest 15 minutes of SIP data, so current snapshots use `feed=iex`.
  - News is included in the free plan. Its stories came from Benzinga and, as of 2026-11-21, come from Fiscal.ai;
    they cover stocks and ETFs and tag no crypto (`BTCUSD`, `BTC/USD` return nothing; `BTC` is a mining stock).
  - Keep the feed in configuration, so Algo Trader Plus (all exchanges, no caps) is a config change.
- UI primitives: `radix-ui` provides focus, layering and keyboard behavior for Dialog, Menu, Tooltip,
  SegmentedControl, Tabs and Switch. Features import our `components/ui/*` wrappers, never Radix directly.
- Client state: `zustand` stores. Live quotes use per-symbol selectors so one tick re-renders one row.
- Validation (backend): `class-validator` + `class-transformer` only. No Zod. Request DTOs go through
  `transformAndValidate` / `validateRequest` (whitelist + forbidNonWhitelisted); config goes through
  `loadConfig` (only declared variables are read, blank means unset, errors never print values).
- Server build: **tsc** (`tsc -b tsconfig.build.json`), because esbuild/tsx don't emit decorator metadata.
  Verified 2026-11-14: Vitest 5's transform does emit `design:type` (a test in `validate.test.ts` guards it).
  `useDefineForClassFields: false` for the legacy-decorator libraries. `packages/shared` compiles to `dist`
  with one subpath export per file and is a TS project reference of the server.
- Desktop shell: **Electron 45 + electron-vite 6** (builds main, a sandboxed CommonJS preload and the
  renderer, restarts on change). Windows use contextIsolation, sandbox, no nodeIntegration; navigation
  rules live in `electron/navigation.ts`. The production CSP is injected at build time only, because
  Vite's dev server serves inline scripts. `npm run smoke` proves a build starts.
- Market data is **provider-agnostic** (user request, 2026-11-14): services depend on the `MarketDataProvider`
  port in `apps/server/src/marketData/provider.ts`; each vendor is an adapter selected by
  `MARKET_DATA_PROVIDER`, and its plan limits are data the rate limiter and stream budget read.
- Alpaca SDK: **`@alpacahq/alpaca-trade-api` 5.x**, the official TypeScript SDK (checked 2026-11-14 against
  5.0.0's shipped types and source). It passes what the adapter needs: `fetchApi` and stream `url` overrides
  make it testable without keys (the `/testing` subpath has `mockFetch`); streams expose state, auth results,
  Alpaca's error codes (406 = second connection) and bounded reconnects (10 attempts, 1 s to 64 s backoff);
  REST throttles itself and retries idempotent reads. Its generated parsers copy values unchecked, so
  `alpacaPayloads.ts` validates every field. Alpaca's `@alpacahq/typescript-sdk` is still a 2025 preview.
- Market-data safety and setup:
  - The adapter builds only `MarketDataClient` and the read-only `trading.AssetsApi`, never `Alpaca` or
    `TradingClient`, so no order method is reachable from the server.
  - The asset list lives on the paper-trading host, so the app needs **paper-trading keys**, which can't
    touch real money either way.
  - Without keys the server still runs; the provider is `null` and market-data endpoints answer 503
    UNAVAILABLE with setup steps. `/health` doesn't fail over it.
  - Provider failures become `ProviderError` (credentials, entitlement, rate_limited, unavailable,
    rejected) with our own messages; SDK errors are never logged raw, and a test checks the keys never reach
    the log.
  - Caches are in memory with TTLs and size caps (`TtlCache`), not Redis: one backend instance needs nothing
    shared. Redis comes in when something does (the news cache per plan section 2.6).
- Market-data rules learned from real data (2026-11-21):
  - Staleness (`quotes.ts`): a quote is `stale` once its newest trade and bid/ask are both over 15 minutes old
    (plus 15 minutes on a delayed feed). IEX stock quotes stop at the 4 PM close; crypto quotes update every
    second while crypto trades can be an hour apart, so bid/ask must count.
  - History floors per feed and asset class (`HISTORY_START` in `alpacaProvider.ts`): IEX stocks 2020-07-27,
    SIP 2016-01-04, crypto 2021-01-01. They set "earliest available" starts and the `truncated` flag.
  - Movers: the screener (max 50 movers, 100 most active) ranks warrants, units, sub-dollar shares and listings
    with months-old IEX prices (a new "SONN" showed +3,949%). The service asks for 50, keeps catalog stocks
    and ETFs whose names don't say warrant/unit/right, priced at $1 or more, that traded in the latest session,
    orders gainers and losers by the quote's own `changePct` (dropping sign mismatches), keeps the screener's
    order for most active, caches one filtered set and slices it per limit.
- Live prices (`liveMarketData.ts`, `alpaca/alpacaStream.ts`):
  - `planSubscriptions` puts the watchlist first (it always fits a stream), then focus (the open stock page,
    from realtime `focus` messages), then enabled alerts, then viewed (every symbol a realtime connection
    subscribes to); the rest is polled.
  - A symbol is streamed only once Alpaca's `subscription` frame confirms it and its channel is connected.
    Everything else, including a dropped channel's symbols, is polled: one batched snapshot per 15 s round.
    Streamed symbols get a snapshot once a minute (volume, range, previous close).
  - `MarketState` merges per field group: trade time owns `last`, quote time owns bid/ask, snapshots own the
    day bar and previous close, so a late snapshot never overwrites a newer tick.
  - The SDK reconnects 10 times (1 s to 64 s). Once it gives up, the live service calls `reconnect()` every
    5 minutes; rejected keys (`retryable: false`) are never retried. The adapter reports "disconnected" only
    when no retry follows (the SDK sets "waiting to reconnect" in the same tick).
  - Watchlist and alert services take an `onChange` callback, called after commit; `refresh()` folds bursts
    into at most one extra run. `start()` never rejects and runs from `onReady` without blocking `listen`;
    `stop()` runs in `onClose`, before the database closes.
  - Stream errors are mapped to our own words (`FAILURES` in `alpacaStream.ts`) because the auth frame
    carries the keys. Tests run the real SDK against `test/fakeAlpacaStream.ts`, a local msgpack server.
- News (`news/`, plan section 2.6):
  - Filtering, de-duplication, scoring and assembly are pure functions in `newsRules.ts`; every weight is in
    `NEWS_WEIGHTS`. Grouping is union-find over duplicate pairs, so it is order-independent. When the
    per-symbol cap leaves places in the first 10, market stories fill them before the watchlist overflow.
  - Sources implement `NewsSource` (`newsSource.ts`). Alpaca news is built on the adapter's own
    `MarketDataClient` (`provider.news`), so it shares the rate limit, and reads newest-first pages only up to
    100 articles per query. Alpaca's docs show crypto as compact pairs (`BTCUSD`), so the adapter queries with
    and maps that form to the app's (`BTC/USD`), but the current source tags no crypto at all, so crypto pairs
    get no news. Only http(s) links pass; ids are namespaced (`alpaca:<id>`).
  - `NewsService` refreshes both pools every 3 minutes into the cache (5-minute TTL, keys `news:v1:...`). The
    watchlist pool is keyed by its symbols, so a changed watchlist fetches its own. Requests rank on the spot
    with `loadMarketInputs` (quotes, 20-day average daily volume from cached daily bars, most active, names),
    each part optional so a missing one scores 0. A failed fetch falls back to the last good pool.
- Alert evaluation (`alerts/alertMonitor.ts`) runs on the server with the shared engine
  (`@aperture/shared/alertEngine`, the same rules as the app's simulated backend):
  - Enabled alerts are cached in memory; a price that changes nothing costs no database work. The live
    service's `onPrice` feeds it every newer trade price, live or from a poll (a polled symbol's first
    snapshot counts), and alert changes call `reload()`. Alerts load before prices start.
  - Firing or re-arming is saved with a conditional `UPDATE ... WHERE enabled AND armed = <evaluated> AND
    condition/target unchanged`, plus the history row, in one transaction. No row updated means the alert
    changed (an edit, another price, another process): the monitor re-reads it and nothing fires. That is
    what prevents duplicate notifications, including across restarts (the armed state is saved).
  - Prices that arrive while one of an alert's changes is being saved wait in a single slot (newest
    wins), which bounds memory and database work during an outage. Listeners (`onTriggered`, `onUpdated`)
    run only after the save commits. `updatedAt` is bumped in SQL with `GREATEST(now, updated_at + 1 ms)`.
- Realtime WebSocket (`realtime/`, `@fastify/websocket` 11, the official plugin on `ws`; protocol in
  `@aperture/shared/realtime`):
  - One path, `/realtime`, JSON messages with a `type`. App to server: `subscribe`/`unsubscribe` (diffs,
    at most 200 symbols per connection), `focus` (symbol or null). Server to app: `quotes`, `status`,
    `alert`, `alertUpdated`, `error`. Client messages are validated with class-validator DTOs
    (`realtimeMessages.ts`); a bad one gets an `error` message and the connection stays open.
  - A subscribe answers at once with `latest()` quotes (marked stale when not current); that snapshot is
    the recovery path after a reconnect. Later changes are coalesced per connection into one batch every
    250 ms, one quote per symbol. Status is broadcast only when it changes (ignoring `lastPollAt`).
  - The hub (`realtimeHub.ts`) depends on `RealtimeSources` functions, not on the live service, so it runs
    without market data (status says `configured: false`) and tests can drive it directly.
  - Safety: connections from other web pages are refused in `preValidation` (403 `FORBIDDEN`, a new error
    code) because browsers let any page open a WebSocket to localhost. Allowed origins: the dev renderer
    (`http://localhost:5173`, `http://127.0.0.1:5173`), the packaged app (`file://`), and no Origin header
    (non-browser clients). Messages over 16 KB close with 1009, a 21st connection gets 1013, a connection
    that misses a 30-second ping or buffers over 1 MB is terminated (the app reconnects and resubscribes).
  - The packaged app's `file://` origin is assumed from Chromium's behavior; verify it once the app's
    client connects (frontend integration).
- Redis (`redis/redisConnection.ts`, official `redis` 6.x client): only caches live there (news for now), so
  the server runs without it. `disableOfflineQueue` makes commands fail at once while it is down, and
  `RedisNewsCache` falls back to memory. An `error` listener is required (unhandled errors crash the process).
  It retries 10 times with backoff, then every 5 minutes from the `terminated` event; down and back are logged
  once each, by message only. `main.ts` owns the connection; `buildApp` only takes the cache and a readiness
  view for `/health` (informational, never changes the status code).
- Lint config: one `eslint.base.js` at the root; each workspace adds its globals and plugins.
- Shared code: `packages/shared` holds the API contracts and the rules both sides enforce: symbols, alerts,
  the alert engine, chart ranges (`resolveRange`) and the instrument search ranking.
  Each export has a `source` condition pointing at its TypeScript, which the desktop app resolves
  (`customConditions` and Vite `resolve.conditions`), so it never needs the package built. The server
  resolves `dist` through its project reference. The app keeps its own copies of the API types until it
  talks to the backend; `domain/contracts.test.ts` fails typecheck when they drift.
- Persistence (verified at runtime 2026-11-14 with TypeORM 1.1.3, pg 8.23, Postgres 18.7):
  - Entities and migrations are listed explicitly in `db/dataSource.ts`, never found by glob.
    `synchronize` stays off everywhere. The server runs pending migrations at startup.
  - Single local user, no users table. The `watchlists` table holds exactly one row (id 1, a CHECK
    constraint), seeded by the first migration. Watchlist changes lock that row, which serializes them.
  - Prices are `double precision` (round-trips JS numbers exactly). Alert ids are UUIDs made in the app.
  - `updatedAt` strictly increases (`nextUpdatedAt`), because the app drops alert copies older than the
    one it has.
  - Server tests run against a Testcontainers PostgreSQL and Redis started once per run
    (`src/test/globalSetup.ts`, images read from `compose.yaml`), with test files run one at a time. **Docker must be running for
    `npm run check`.** `migrations.test.ts` fails when entities and migrations drift.
  - Trigger history lives in `alert_events`, an append-only log without a foreign key, so it outlives an
    edited or deleted alert (as in the app). The newest 1,000 rows are kept.

## Server architecture (`apps/server`)
- One folder per feature (`watchlist/`, `alerts/`) with its entities, DTOs, service and routes. Services hold
  the business rules; routes only validate (`validateRequest` with DTO classes) and call a service.
- DTOs check fields with the shared rules through `FollowsRule`, so the API and the app report the same
  messages. `Omittable` marks optional fields in partial updates: unlike `IsOptional` it still rejects null.
- `db/`: the data source, migrations, startup (`openDatabase`, bounded retry) and `isDatabaseUnavailable`,
  which the error handler turns into 503 UNAVAILABLE.
- `realtime/`: the WebSocket hub, message DTOs and route; tests use real `ws` clients
  (`test/realtimeClient.ts`) against the server listening on a random port.
- `news/`: rules, the `NewsSource` port, the service, market inputs, caches (memory and Redis), DTOs and
  routes; tests use `test/fakeNewsSource.ts`. `redis/`: the connection.
- `marketData/`: the provider port (`provider.ts`), one folder per adapter (`alpaca/`: REST adapter, stream,
  payload checks, doc-shaped fixtures), `createProvider.ts` (picks the adapter from config), the REST service
  (`marketDataService.ts`), the live service (`liveMarketData.ts`, `marketState.ts`, `streamPlan.ts`), DTOs
  and routes. Tests use `test/fakeProvider.ts` (with a hand-driven `FakeStream`) for the services and routes,
  the SDK's `mockFetch` for the adapter's REST side and `test/fakeAlpacaStream.ts` (a local msgpack server)
  for its stream. `npm run check` never opens a real Alpaca connection.

## Desktop app architecture (`apps/desktop`)
- `electron/`: main process (`main.ts`), preload (`preload.ts`, the typed `window.aperture` bridge from
  `bridge.ts`) and the navigation policy. `src/`: the React renderer, described below.
- `domain/`: the app's copies of the API types (`types.ts`), checked by `contracts.test.ts`. The alert engine,
  chart ranges and search ranking live in `packages/shared`.
- `lib/`: formatting and small utilities.
- `data/api.ts` and `data/realtime.ts`: **interfaces** that mirror the future HTTP API and WebSocket client.
  `data/mock/` implements them with clearly labeled simulated data. In Phase 5 the mocks are replaced
  by real clients and the UI stays as it is.
- `data/dataLayer.ts` defines the `api`/`realtime` singletons and `startDataLayer`. Hooks live in
  `quoteStore.ts`, `connectionStore.ts` and `simulationStore.ts`; import them from there.
- `components/ui/`: design-system primitives. `features/<area>/`: feature UI. `styles/`: tokens and global CSS.
- `App.tsx` owns the layout grid and landmarks; each feature renders content only inside its area.
  `app/` holds cross-feature UI state (`uiStore.ts`), startup, quote subscriptions and global shortcuts.
  The design-system showcase is at `#showcase`.
- Rules that both the UI and the API enforce (symbols, the watchlist limit, alert fields) live in
  `packages/shared`, so forms validate without a round trip and report the same messages as the API.
- Alert evaluation lives behind the realtime interface (the "backend" side), never inside UI components.

## Rules
- Never present simulated prices as real. Every mock surface shows a visible "Simulated" marker.
- Keep business logic out of React components and out of route/transport handlers.
- Use well-maintained packages when they clearly simplify the work, e.g. `dayjs` (with its `utc` and
  `timezone` plugins) for date math instead of hand-rolled calendar code. Write our own code when it's small
  and the package's cost (size, maintenance, complexity) outweighs the benefit. Justify each new
  dependency in one line in the report or PR.
- Don't edit a file another parallel task owns. One task, one branch, one owner per file.
- Every builder report includes: branch, files changed, and the check command with its result.
- Commit messages describe the work itself. Never mention plan phases or plan structure
  (no "Phase 0", "Phase 2", etc.). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are fine.
- No AI attribution anywhere: no `Co-Authored-By: Claude` trailers in commits and no
  "Generated with Claude Code" lines in PR descriptions. This overrides any tool default.

## Files and imports
- **No barrel files.** Import every module from its own file; re-exports are lint errors. The one
    exception are `Skeleton` namespaced objects.
  Why: Vite serves modules unbundled in dev, so importing one name from a barrel loads every module it
  re-exports; barrels also hinder tree shaking. ESLint enforces this (`no-restricted-syntax` bans
  `export * from` and `export { x } from`). Don't name modules `index.ts`; name them for what they hold.
- Only export what another file imports.

## Documentation Style

**Code Comment Style:** Write comments in a **concise, intent-focused, plainspoken style**.

- Explain **what the code is doing and why it exists**, not how each line works.
- Focus on the **behavior or invariant** the code is enforcing.
- Prefer **one or two short sentences** over a detailed explanation.
- Use simple language that can be understood without knowing the implementation details.
- Avoid restating obvious code. The comment should explain something that isn't immediately apparent from reading the code.
- Avoid unnecessary implementation details, historical context, or consequences that don't help explain the purpose.
- Use precise terminology, but favor readability over technical jargon.
- Describe important edge-case behavior when it is relevant to understanding the function.
- Keep comments proportional to the complexity of the code.

**Good:**

```ts
// Deduplicate concurrent attempts for the same navigator. Once the attempt completes or fails,
// remove it so the next call can start a new attempt.
```

**Avoid:**

```ts
// One attempt per navigator at a time: repeat calls join the attempt in flight. Settling in either
// direction clears it, so a failed or restored attempt can run again.
```

The goal is for a developer to read the comment and immediately understand **"Why does this code work this way?"** without having to mentally translate the comment first.
Inline comments that explain a non-obvious decision start with `// **`.

## Verification (run it; never assume)
- From the repo root, `npm run check` runs every workspace's check (typecheck, lint, knip, test, build).
  Green `check` is the bar for every task. Inside one workspace, `npm run check` runs just that one.
- UI changes must also be opened in the browser and walked end to end.
- A failed check sends the task back with evidence. Three attempts max, then escalate.

## Lessons learned (add a line when a mistake repeats)
- Adversarial QA reports only defects a real user could hit, or broken contracts. Exotic inputs (rare
  Unicode case folding, year 0, Number.MAX_VALUE gaps) burned two session limits without user value.
  Cap QA at one or two rounds and give it a severity bar.
- Never resume a workflow that runs parallel branches while another task writes to one of its worktrees.
  Resume can re-run finished agents live, and two writers then collide in one worktree.
- An agent that starts a dev server must kill its own PID (`taskkill //PID <pid> //T //F`) and confirm
  the port is free. Orphaned Vite servers lock rolldown's binary, and `npm ci` then half-deletes node_modules.
- Parallel agent fan-outs die on the plan's session limit, and three runs lost their QA stage that
  way. Builders commit after every step and resume from their branch. Keep parallel QA small, or run
  the integration walk inline.
- Tool parameters decode `\uXXXX`, so writing a regex escape through Edit/Write can insert the literal
  character instead. Check the bytes, or use a `\p{...}` class or `String.fromCharCode` instead.
- Never give two files in one folder names that differ only by case (`WatchlistSummary.tsx` and
  `watchlistSummary.ts`, `SimulatedBadge.tsx` and `simulatedBadge.css`). Windows resolves them as one,
  and both times Vite served the wrong module.
- `git stash push <path>` also stashes renames already staged with `git mv`, and popping it then conflicts.
  Commit or unstage the renames before stashing one path.
- `npm install` didn't download Electron's runtime here (2026-11-14). Run `node node_modules/electron/install.js`
  with `electron_config_cache` set, and check `node_modules/electron/dist` exists.
- Reproduce a flaky test before fixing it: run it with `{ repeats: 40 }` and log the state it asserts on.
  A guessed fix (`ea66de1`) left the unread-count flake in place; the cause was the seeded demo alerts, which
  fire about a minute into a session. QA tests that count app-wide state must turn those alerts off first.
  The simulated market is shared across QA tests, each an hour later than the last, so a symbol's last trade
  can be an hour old: wait for its quote to turn live (`runFeedUntil`) instead of a fixed `advance`.
- Run prettier on the files you changed, never on a whole folder (`prettier --write src`). It reformatted the
  same untouched files (`loadConfig.ts`, `loadConfig.test.ts`, `validate.ts`) in three PRs, and each time they
  had to be restored by hand. Check `git status` for unexpected files before committing.
