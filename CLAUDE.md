# Aperture — Desktop Stock Monitoring & Analysis

Electron + React desktop app with a Fastify backend for market **monitoring and analysis only**.
It must never place orders or execute trades. Buy/Sell on alerts are user labels, nothing more.
The full spec is `stock-app-plan.md`. Read it before you change architecture.

## Current phase
- Phase 0 (interactive prototype): **approved by the user on 2026-11-13.** It includes the multi-page
  redesign, the visual polish pass (tag `before-ui-polish` marks the state before it) and the news card.
  Watchlist-curated news ranking is specified in plan section 2.6 for later.
- Phase 1 (project foundation): **built on `feat/project-foundation`, awaiting merge.** Workspaces, the
  hardened Electron shell, the Fastify server (config, validation pipeline, errors, health), shared
  contracts, Docker Compose (verified healthy 2026-11-14: Postgres 18.7, Redis 8.8.4) and the README are
  done. Next: Phase 2, persistence and API.
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
- `main` is protected by convention: work happens on `feat/*` branches and merges only with a green check.
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
- Market data: Alpaca **free plan, IEX feed** (decided 2026-11-07; the user has no Alpaca account yet).
  IEX quotes and trades are real-time but cover only the IEX exchange, so label them "IEX" and never as
  consolidated prices or volume. Alpaca provides no fundamentals (market cap, P/E, EPS): don't show them
  unless another source is added. Free-plan limits the backend must respect (checked 2026-11-14):
  - 200 REST calls/min: batch with multi-symbol endpoints (snapshots, bars), cache, and rate-limit below 200
    with backoff on 429. Never fetch history or sparklines one symbol per request.
  - Streams: 1 connection per endpoint (a second client on the same keys gets 406) and 30 symbols per
    stream; the 30-symbol cap applies to the crypto stream too. Budget slots by priority: open symbol
    page, enabled alerts, watchlist rows; poll the rest.
  - REST requests can't reach the latest 15 minutes of SIP data, so current snapshots use `feed=iex`.
  - News: the Benzinga feed is included in the free plan.
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
- Lint config: one `eslint.base.js` at the root; each workspace adds its globals and plugins.

## Desktop app architecture (`apps/desktop`)
- `electron/`: main process (`main.ts`), preload (`preload.ts`, the typed `window.aperture` bridge from
  `bridge.ts`) and the navigation policy. `src/`: the React renderer, described below.
- `domain/`: pure types and logic that carry over to production (types, alert engine, chart ranges, symbol rules).
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
- Domain rules that both the UI and the API enforce (symbols, watchlist names, alert fields) live in
  `domain/`, so forms validate without a round trip and report the same messages as the API.
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
- `npm install` didn't download Electron's runtime here (2026-11-14). Run `node node_modules/electron/install.js`
  with `electron_config_cache` set, and check `node_modules/electron/dist` exists.
