# Aperture — Desktop Stock Monitoring & Analysis

Electron + React desktop app with a Fastify backend for market **monitoring and analysis only**.
It must never place orders or execute trades. Buy/Sell on alerts are user labels, nothing more.
The full spec is `stock-app-plan.md`. Read it before you change architecture.

## Current phase
- Phase 0: interactive prototype in `prototype/`. **It is an approval gate.** Do not start
  backend, database, Docker or Electron scaffolding until the user has approved the prototype in chat.
  Status (2026-11-07): prototype complete and presented; **awaiting the user's approval**.
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
- UI primitives: `radix-ui` provides focus, layering and keyboard behavior for Dialog, Menu, Tooltip,
  SegmentedControl, Tabs and Switch. Features import our `components/ui/*` wrappers, never Radix directly.
- Client state: `zustand` stores. Live quotes use per-symbol selectors so one tick re-renders one row.
- Validation (backend): `class-validator` + `class-transformer` only. No Zod.

## Prototype architecture (`prototype/src`)
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
From `prototype/`:
- `npm run typecheck` · `npm run lint` · `npm run test` · `npm run build`
- `npm run check` runs all four. Green `check` is the bar for every task.
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
