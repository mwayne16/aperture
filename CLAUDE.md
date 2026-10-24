# Aperture — Desktop Stock Monitoring & Analysis

Electron + React desktop app with a Fastify backend for market **monitoring and analysis only**.
It must never place orders or execute trades. Buy/Sell on alerts are user labels, nothing more.
The full spec is `stock-app-plan.md`. Read it before you change architecture.

## Current phase
- Phase 0: interactive prototype in `prototype/`. **It is an approval gate.** Do not start
  backend, database, Docker or Electron scaffolding until the user has approved the prototype in chat.
- Track phase status in this section. Update it whenever a phase is approved or completed.

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

## Toolchain decisions (don't revisit without a reason written down here)
- TypeScript is pinned to **~6.0.3** everywhere. Verified 2026-10-23: TS 6.0.3 compiles a TypeORM 1.1.2
  entity plus class-validator/class-transformer DTOs with `experimentalDecorators` + `emitDecoratorMetadata`,
  emits `design:type`, and needs no deprecation flags. TS 7 is blocked because typescript-eslint peers on `<6.1.0`.
  TS 6 defaults to `types: []`, so list needed types (`node`, `vite/client`) explicitly in each tsconfig.
- Before pinning anything below its latest major, prove the incompatibility with a real install and
  compile, and write the evidence here.
- Vite 8, React 19, Vitest 5, ESLint 10 flat config with typescript-eslint strict type-checked rules.
- Charts: `lightweight-charts` v5 (TradingView, Apache-2.0).
- Client state: `zustand` stores. Live quotes use per-symbol selectors so one tick re-renders one row.
- Validation (backend): `class-validator` + `class-transformer` only. No Zod.

## Prototype architecture (`prototype/src`)
- `domain/`: pure types and logic that carry over to production (types, alert engine, chart ranges, symbol rules).
- `lib/`: formatting and small utilities.
- `data/api.ts` and `data/realtime.ts`: **interfaces** that mirror the future HTTP API and WebSocket client.
  `data/mock/` implements them with clearly labeled simulated data. In Phase 5 the mocks are replaced
  by real clients and the UI stays as it is.
- `components/ui/`: design-system primitives. `features/<area>/`: feature UI. `styles/`: tokens and global CSS.
- Alert evaluation lives behind the realtime interface (the "backend" side), never inside UI components.

## Rules
- Never present simulated prices as real. Every mock surface shows a visible "Simulated" marker.
- Keep business logic out of React components and out of route/transport handlers.
- No new dependencies without a one-line justification in the PR or report.
- Don't edit a file another parallel task owns. One task, one branch, one owner per file.
- Every builder report includes: branch, files changed, and the check command with its result.
- Commit messages describe the work itself. Never mention plan phases or plan structure
  (no "Phase 0", "Phase 2", etc.). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are fine.

## Verification (run it; never assume)
From `prototype/`:
- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build`
- `npm run check` runs all four. Green `check` is the bar for every task.
- UI changes must also be opened in the browser and walked end to end.
- A failed check sends the task back with evidence. Three attempts max, then escalate.

## Lessons learned (add a line when a mistake repeats)
- (none yet)
