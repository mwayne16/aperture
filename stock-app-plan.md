# Project: Desktop Stock Market Monitoring & Analysis

## 1. Objective

Build a modern desktop stock market monitoring and analysis application using Electron. The application should provide a fast, responsive interface for monitoring market activity, analyzing stock price movements, managing watchlists, and configuring price alerts.

The application should feel like a professional trading and market-analysis workstation rather than a generic dashboard. Prioritize information density, real-time responsiveness, clear data visualization, and a polished desktop experience.

**This application is for market monitoring and analysis only. It must not execute trades or place orders.** Alert labels such as Buy and Sell are user-defined classifications, not trading instructions executed by the application.

Favor maintainable implementations, clear separation of responsibilities, strongly typed contracts, and straightforward architecture over unnecessary complexity.

## 2. Required Features

### 2.1. Market Overview

- Display a configurable list of stock symbols with their latest available prices.
- Show price changes in absolute and percentage terms.
- Display relevant market data, including volume, bid, ask, and other fields supported by the selected data feed.
- Visually distinguish positive and negative price movements.
- Indicate whether data is live, delayed, stale, or unavailable whenever that status can be determined.
- Support searching for stocks by symbol and, where available, company name.
- Allow users to add and remove stocks from their watchlists.
- Update market data efficiently without unnecessary UI renders or excessive processing.
- Provide clear loading, empty, disconnected, and error states.

Never fabricate live market data or represent simulated prices as real market data.

### 2.2. Watchlists

Allow users to create and manage multiple watchlists.

- Create, rename, and delete watchlists.
- Add and remove stock symbols.
- Select an active watchlist.
- Persist watchlists across application restarts.
- Preserve the ordering of symbols within each watchlist.
- Validate symbol formats and reject duplicate symbols where appropriate.

Watchlists and their configuration belong in PostgreSQL, not Redis.

### 2.3. Stock Details and Historical Charts

Selecting a stock should open a detailed view containing its latest market information and historical price chart.

Support the following chart ranges:

- 1D
- 1W
- 1M
- 3M
- 6M
- YTD
- 1Y
- 5Y
- 10Y
- All

Requirements:

- Use a suitable financial charting library that supports time-series data and responsive interactions.
- Display historical prices using appropriate intervals and granularity for the selected range.
- Include crosshair inspection, timestamp and price tooltips, and range selection where supported.
- Clearly distinguish historical chart data from the latest live quote.
- Handle unavailable historical data, empty results, and API errors gracefully.
- Avoid fetching unnecessarily large historical datasets.
- Respect the market data provider's available timeframes, rate limits, and data-retention restrictions.

### 2.4. Price Alerts

Allow users to create and manage price alerts for individual stock symbols.

Each alert should support:

- Stock symbol.
- Comparison condition, such as price above or below a threshold.
- Target price.
- User-defined Buy or Sell tag.
- Enabled or disabled status.
- Creation and update timestamps.
- Last-triggered information where appropriate.

The alert system must:

- Monitor incoming market prices against enabled alert conditions.
- Trigger an alert when its configured condition is met.
- Prevent repeated notifications while the same condition remains continuously satisfied.
- Define re-arming behavior so an alert can trigger again after the price leaves the configured condition and subsequently re-enters it.
- Persist alert configuration and relevant trigger metadata in PostgreSQL.
- Deliver alert events to the Electron application through the backend's real-time connection.
- Display native desktop notifications through Electron.
- Handle application restarts without losing configured alerts.

Explicitly define which market-data field is used to evaluate each alert, such as the latest trade price or a supported quote field. Make the behavior clear in the UI.

The backend is responsible for evaluating alerts. The frontend must not be the sole source of alert evaluation.

### 2.5. Desktop Experience

- Support a native application window and appropriate window lifecycle behavior.
- Display desktop notifications for triggered alerts.
- Provide clear connection and market-data status indicators.
- Handle startup, shutdown, and reconnection gracefully.
- Keep the UI responsive during frequent market updates.
- Use secure Electron defaults, including context isolation and disabled renderer Node.js integration.
- Expose only necessary Electron functionality through a narrowly scoped, typed preload API.

Never expose unrestricted Node.js or Electron APIs directly to the renderer process.

## 3. Technology Stack

Use the following technologies unless a documented technical limitation justifies a change.

### Frontend

- Electron
- React
- TypeScript
- Vite
- A suitable financial charting library

### Backend

- Node.js
- TypeScript
- Fastify
- WebSocket
- Alpaca Node SDK for market data
- TypeORM
- `class-validator`
- `class-transformer`
- Pino
- Vitest

### Data and Infrastructure

- PostgreSQL for persistent application data.
- Redis for caching, transient market state, and Pub/Sub where appropriate.
- Docker and Docker Compose for local infrastructure.

### Validation Architecture

Use `class-validator` and `class-transformer` as the standard approach for runtime validation and transformation of typed inputs.

Define HTTP request DTOs, configuration classes, and other appropriate external-input contracts as TypeScript classes with property decorators.

Use strict TypeScript settings and configure the compiler and runtime for the chosen decorator libraries, including legacy decorator support and metadata reflection where required.

## 4. Required Architecture

### 4.1. Electron Application

Separate the Electron application into three responsibilities:

- **Main process:** Window lifecycle, native notifications, application-level events, and operating system integration.
- **Preload layer:** A small, typed API exposing approved capabilities to the renderer.
- **Renderer process:** React UI, user interactions, charts, watchlists, and presentation of market data.

The renderer communicates with the backend through its HTTP API and WebSocket connection. Use the preload layer for functionality that genuinely requires Electron integration.

### 4.2. Backend Services

Organize the backend into focused modules or services.

- **HTTP API:** Watchlists, alerts, stock search, historical data requests, and other application operations.
- **Market Data Service:** Maintains the connection to Alpaca, manages subscriptions, and normalizes incoming market data.
- **Market State Service:** Maintains the latest market state needed by active clients and backend consumers.
- **Alert Service:** Evaluates incoming prices against configured alert conditions and generates alert events.
- **Persistence Layer:** Uses TypeORM and PostgreSQL for persistent application state.
- **Cache and Messaging Layer:** Uses Redis where caching or cross-process communication provides a meaningful benefit.
- **WebSocket Service:** Publishes market updates, connection status, and alert events to connected clients.
- **Configuration Layer:** Loads, transforms, validates, and exposes application configuration at startup.
- **Validation Layer:** Provides reusable DTO transformation and validation utilities for Fastify routes and other external input boundaries.

Keep business logic outside HTTP route handlers and WebSocket transport handlers wherever practical.

### 4.3. Typed DTOs and Decorator-Based Validation

Use class-based DTOs and property decorators as the default approach for defining external inputs.

#### HTTP Request DTOs

Define request bodies, query parameters, path parameters, and other applicable HTTP inputs as typed classes.

Use decorators from `class-validator` such as:

- `@IsString()`
- `@IsEmail()`
- `@IsNotEmpty()`
- `@IsOptional()`
- `@IsEnum()`
- `@IsBoolean()`
- `@IsInt()`
- `@IsNumber()`
- `@Min()`
- `@Max()`
- `@Length()`
- `@IsArray()`
- `@ArrayUnique()`
- `@ValidateNested()`
- `@IsDateString()`

Use `class-transformer` decorators such as `@Type()` and `@Transform()` when input conversion is necessary.

Implement custom validation decorators for domain-specific rules when built-in decorators are insufficient.

#### Shared Validation Pipeline

Implement reusable validation utilities that:

1. Receive untrusted external input.
2. Transform plain objects into instances of the appropriate DTO class.
3. Apply the configured transformation and unknown-property policies.
4. Validate the resulting instance.
5. Reject invalid input before business logic executes.
6. Return consistent, structured validation errors without exposing sensitive information.

Integrate this pipeline with Fastify using reusable hooks, pre-handlers, or an equivalent centralized mechanism.

Do not repeat transformation and validation logic in individual route handlers.

Ensure the TypeScript types used by route handlers accurately represent the validated input. TypeScript annotations alone do not provide runtime validation.

Explicitly configure unknown-property handling. Reject unexpected fields where appropriate, and prevent mass assignment of database IDs, ownership fields, internal flags, or other properties that clients must not control.

For partial-update DTOs, explicitly define which fields are optional and how omitted fields differ from explicit `null` values.

Support nested DTOs, arrays of DTOs, optional fields, enums, custom validators, and input transformation.

#### Other External Inputs

Apply the same class-based validation approach to WebSocket messages, externally supplied JSON, and other untrusted inputs where appropriate.

Do not assume data returned by a third-party SDK is runtime-validated simply because the SDK provides TypeScript types.

For external market-data payloads, validate at the integration boundary when necessary, using DTO classes or suitable custom validators. Normalize validated provider data into internal application types before distributing it to other services.

Use the same approach for application configuration, HTTP DTOs, and external payloads where practical. Avoid introducing additional schema-validation libraries without a specific, documented justification.

### 4.4. DTOs, Domain Models, and Persistence Entities

Keep the following concepts separate:

- **DTOs:** Define and validate external input and, where useful, explicit API response contracts.
- **Domain models:** Represent application concepts and business rules.
- **TypeORM entities:** Represent database persistence and relationships.
- **Provider models:** Represent or normalize data received from external market-data services.

Do not use TypeORM entities directly as HTTP request DTOs.

Do not allow clients to control internal persistence fields simply because they exist on an entity.

Use explicit mapping between DTOs, domain models, and persistence entities where appropriate. Avoid unnecessary mapping layers when a simpler, clear implementation is sufficient.

### 4.5. Market Data Flow

Use a centralized market-data pipeline:

1. The backend establishes and maintains the appropriate Alpaca market-data connection.
2. The Market Data Service subscribes to required symbols and supported data channels.
3. Incoming messages are validated or normalized as appropriate.
4. The backend updates relevant in-memory or Redis-backed market state.
5. The Alert Service evaluates relevant updates against configured alert conditions.
6. The WebSocket Service distributes updates and alert events to connected clients.
7. The React interface applies updates efficiently and displays current market status.

Do not create separate Alpaca connections for individual stocks, UI components, or renderer views.

Implement subscription management so the backend can add and remove symbols as demand changes. Avoid duplicate subscriptions and unnecessary upstream traffic.

Keep the initial implementation appropriate for a single desktop user and one backend instance. Do not introduce distributed infrastructure unless it solves a real requirement.

### 4.6. HTTP API and WebSocket Protocol

Design explicit, typed contracts between the frontend and backend.

- Validate incoming HTTP requests using the shared DTO validation pipeline.
- Define consistent response and error formats.
- Handle invalid requests, missing resources, provider errors, and unavailable infrastructure.
- Define typed WebSocket event contracts for market updates, alert events, connection status, and subscription management.
- Validate externally supplied WebSocket messages before processing them.
- Implement reconnection behavior with appropriate backoff.
- Restore required subscriptions after reconnection.
- Provide a way to recover current market state after reconnecting instead of relying exclusively on events that may have been missed.

Avoid sending the entire market state for every update. Send focused updates and batch or coalesce high-frequency changes where appropriate.

## 5. Data Storage and Persistence

### 5.1. PostgreSQL

PostgreSQL is the source of truth for persistent application state.

Use TypeORM entities and migrations for:

- Watchlists and their stock symbols.
- Price alert configurations and relevant trigger metadata.
- User preferences and application settings when persistence is needed.
- Other durable application data introduced by the implementation.

Design entity relationships and indexes around expected query patterns.

Use TypeORM migrations to manage schema changes. Do not rely on automatic schema synchronization as the production migration strategy.

Do not write every incoming market-data event to PostgreSQL. Persist market history only if a specific requirement justifies it and the provider's licensing and data-retention terms permit it.

### 5.2. Redis

Redis is a supporting infrastructure component, not the source of truth for persistent application state.

Use Redis only where it provides a clear benefit, such as:

- Caching recent market data.
- Holding transient market state.
- Publishing market updates or application events between backend instances if multiple instances are introduced.
- Short-lived coordination or cached results.

Do not duplicate PostgreSQL persistence in Redis without a defined reason.

The application must remain straightforward to run with one backend instance. Redis Pub/Sub between multiple backend instances is optional until that architecture is needed.

### 5.3. Connection Management and Failure Handling

- Load connection settings through the validated configuration layer.
- Handle connection failures and recovery gracefully.
- Do not report infrastructure as ready until required dependencies are available.
- Close database, Redis, market-data, and WebSocket connections cleanly during shutdown.
- Avoid unbounded retries, tight reconnect loops, and uncontrolled memory growth.

## 6. Docker and Local Development Infrastructure

Use Docker Compose to manage local infrastructure dependencies.

### Required Containers

- **PostgreSQL:** Persistent application database.
- **Redis:** Cache and transient-state infrastructure.

### Docker Requirements

- Define services in a root-level `compose.yaml`.
- Configure health checks for PostgreSQL and Redis.
- Use a named Docker volume for PostgreSQL data.
- Configure Redis persistence only if required by the chosen use case.
- Make ports and credentials configurable through environment variables.
- Provide an `.env.example` file documenting required configuration.
- Keep local secrets in an untracked `.env` file or another appropriate secret mechanism.
- Ensure PostgreSQL and Redis do not require host installations.
- Configure the backend to connect through exposed host ports during local development and use service names when it runs inside Docker.
- Document startup, shutdown, logs, status, and database-reset commands.

Run PostgreSQL and Redis in Docker containers during local development. Run Electron and the Node.js backend directly on the host by default unless containerizing them provides a concrete benefit.

Provide these documented commands:

```bash
# Start infrastructure
docker compose up -d

# Check service status
docker compose ps

# Follow infrastructure logs
docker compose logs -f

# Stop containers without deleting persistent data
docker compose down

# Delete containers and persistent volumes
# WARNING: This permanently deletes data stored in those volumes.
docker compose down -v
```

Keep development infrastructure separate from Electron packaging and production deployment. Do not require Docker to be installed by end users simply to run the packaged desktop application.

## 7. Development Workflow

Implement the application in the following order. Each phase should leave the project in a coherent, verifiable state.

### Phase 0: Interactive Prototype — Mandatory Approval Gate

Before writing application code, build an interactive frontend prototype for review and approval.

The prototype must:

- Demonstrate the intended application layout, navigation, and visual hierarchy.
- Include a stock list with representative prices and market indicators.
- Include interactive watchlist management.
- Include stock details and historical chart views.
- Include alert creation and management.
- Demonstrate the intended real-time update behavior using mock data.
- Include appropriate empty, loading, disconnected, and error states.
- Use the requested visual theme and design direction.
- Be interactive enough to evaluate the primary workflows without requiring a backend, live market data, PostgreSQL, Redis, or Docker.

Use clearly identified mock data. Do not imply that simulated prices are live market information.

**Stop after presenting the prototype. Do not begin production application scaffolding, backend implementation, database configuration, or Docker setup until the user has explicitly reviewed and approved the prototype.**

Incorporate requested changes before proceeding. Approval of the prototype authorizes the next phase; it does not remove the remaining requirements in this prompt.

### Phase 1: Project Foundation

After prototype approval:

- Establish the project structure and workspace conventions.
- Configure Electron, React, Vite, TypeScript, and the Fastify backend.
- Configure the TypeScript compiler and runtime for the chosen decorator libraries.
- Configure `class-validator`, `class-transformer`, and metadata reflection where required.
- Configure linting, formatting, and Vitest.
- Implement the shared DTO transformation and validation utilities.
- Implement the typed configuration class and startup validation.
- Set up Docker Compose for PostgreSQL and Redis.
- Establish safe secret handling and configuration loading.
- Add a README with installation, setup, and development instructions.

Prefer a clear project structure over unnecessary abstraction or premature modularization.

### Phase 2: Persistence and API

- Define the PostgreSQL schema and TypeORM entities.
- Create and validate database migrations.
- Define typed request DTO classes for watchlist and alert operations.
- Implement validation for request bodies, query parameters, and path parameters.
- Integrate the shared validation pipeline with Fastify.
- Implement watchlist and alert management endpoints.
- Add consistent error handling and structured logging.
- Add repository- or service-level tests for important business behavior.
- Verify persistence across backend restarts.

### Phase 3: Market Data Integration

- Integrate the Alpaca Node SDK.
- Validate required API configuration at startup.
- Implement centralized market-data connection and subscription management.
- Validate or normalize incoming market-data payloads at the integration boundary as appropriate.
- Define typed internal market-data contracts.
- Implement historical data retrieval for chart views.
- Add connection-state tracking, reconnection, and error handling.
- Handle provider limitations and subscription entitlements explicitly.

### Phase 4: Real-Time Updates and Alerting

- Implement the WebSocket protocol and typed event contracts.
- Publish market updates to connected clients.
- Validate incoming WebSocket messages.
- Implement alert evaluation and duplicate-notification prevention.
- Implement alert re-arming and persistence of relevant trigger metadata.
- Deliver alert events to Electron and display native notifications.
- Test behavior during disconnections, reconnections, and backend restarts.

### Phase 5: Frontend Integration

- Replace prototype-only mock data with backend integrations.
- Connect watchlists and alerts to the HTTP API.
- Connect market views to the WebSocket service.
- Integrate historical chart data.
- Implement loading, error, stale-data, and disconnected states.
- Optimize updates to prevent unnecessary rendering and excessive UI work.
- Preserve the approved visual design throughout implementation.

### Phase 6: Testing and Reliability

- Write unit and integration tests using Vitest.
- Test DTO validation rules, input transformations, and invalid request handling.
- Test environment configuration validation, including missing and invalid values.
- Test backend services, API endpoints, and alert logic.
- Test important frontend interactions and state transitions.
- Use isolated test data and prevent tests from modifying development data.
- Verify startup and shutdown behavior.
- Test provider failures, database unavailability, Redis disconnections, and WebSocket recovery.
- Fix critical issues before packaging.

### Phase 7: Packaging and Documentation

- Configure Electron Builder or a comparable packaging tool.
- Support the intended desktop operating systems.
- Configure application metadata, icons, and packaged resources.
- Ensure production configuration does not depend on development-only paths or assumptions.
- Document build, test, packaging, and troubleshooting procedures.

## 8. Design Direction

**Theme:** 
 
Color Palette:

**Dark Mode**
- #0F141B
- #18202B
- #E8EEF6
- #60A5FA
- #34D399
- #F87171

**Light Mode**
- #F3F5F9
- #FDFDFE
- #0F172A
- #2563EB
- #047857
- #DC2626

Table shown below is simply for guidance, ultimately you will need to come up with the full style guide using
color palette provided along with design principles listed. You may take what you like, but you are not constrained
to anything shown in table.

| Role | Dark | Light |
|---|---|---|
| App background | `#0F141B` | `#F3F5F9` |
| Chrome / sidebar / top bar | `#131A23` | `#E9EDF4` |
| Panel surface | `#18202B` | `#FDFDFE` |
| Border | `#273242` | `#DCE2EB` |
| Primary text | `#E8EEF6` | `#0F172A` |
| Muted text | `#94A0B2` | `#5A6478` |
| Accent | `#60A5FA` | `#2563EB` |
| Text on accent | `#0A1424` | `#F8FAFF` |
| Gain | `#34D399` | `#047857` |
| Loss | `#F87171` | `#DC2626` |
| Gain tint (pill background) | `rgba(52,211,153,0.14)` | `rgba(4,120,87,0.10)` |
| Loss tint (pill background) | `rgba(248,113,113,0.14)` | `rgba(220,38,38,0.10)` |
| Window shadow | `rgba(0,0,0,0.5)` | `rgba(15,23,42,0.12)` |


Design principles:

- Clear typography and compact, readable data presentation.
- Strong information hierarchy and consistent spacing.
- Dense but organized tables and watchlist layouts.
- Distinct positive, negative, warning, and neutral market states.
- Consistent styling for buttons, tabs, inputs, menus, dialogs, and tooltips.
- Subtle borders and visual separation instead of excessive cards or decorative gradients.
- Useful hover, focus, selected, and disabled states.
- A cohesive desktop experience that makes effective use of window space.

Prioritize usability and legibility over visual decoration. Do not sacrifice market-data readability to achieve a stylistic effect.

## 9. Non-Functional Requirements

### Performance

- Keep the UI responsive during frequent market updates.
- Avoid unnecessary React renders and repeated expensive calculations.
- Batch or coalesce updates where appropriate.
- Use efficient data structures for tracking symbols, subscriptions, and active alerts.
- Avoid uncontrolled growth in caches, queues, subscriptions, or retained historical data.

### Reliability

- Handle Alpaca disconnections, API errors, rate limits, and unavailable data.
- Handle PostgreSQL and Redis failures without uncontrolled retries or crashes.
- Make connection status visible and distinguish stale data from current data.
- Recover subscriptions and client state after reconnecting.
- Avoid duplicate alert notifications when events are repeated or connections are restored.

### Security

- Never hardcode API keys, database credentials, or other secrets.
- Validate external input at runtime.
- Follow Electron security best practices.
- Restrict renderer access to privileged APIs.
- Avoid logging credentials, access tokens, or other sensitive values.
- Reject unexpected input fields where appropriate.
- Prevent mass assignment and unauthorized access to application resources.

### Maintainability

- Use strict TypeScript settings where practical.
- Prefer class-based DTOs and decorator-driven validation for external inputs.
- Keep DTOs, domain models, and persistence entities separate.
- Keep modules focused and responsibilities explicit.
- Use consistent naming and concise, useful comments.
- Avoid unnecessary abstractions, duplicated logic, and premature distributed-system complexity.
- Document non-obvious architectural decisions and important operational requirements.

## 10. Acceptance Criteria

The implementation is complete when:

- The approved prototype has been implemented as a functioning desktop application.
- The application starts using documented setup instructions.
- PostgreSQL and Redis run through Docker Compose without requiring host installations.
- Watchlists and alerts persist across application and backend restarts.
- Market data is obtained through the centralized Alpaca integration when valid credentials and required data entitlements are available.
- Historical charts support the specified ranges when corresponding data is available.
- Real-time updates reach the UI through WebSocket without excessive rendering or unnecessary provider subscriptions.
- Alert conditions trigger appropriately and do not repeatedly notify while continuously satisfied.
- Electron desktop notifications work as intended.
- Loading, error, stale-data, and disconnected states are handled clearly.
- HTTP request inputs are defined using typed DTO classes and validated at runtime through the shared decorator-based validation pipeline.
- Environment configuration is validated at startup and fails fast when required values are invalid or missing.
- Invalid requests receive consistent, structured validation errors.
- Automated tests cover critical business logic, DTO validation, configuration validation, and important integration paths.
- The application can be packaged for the intended desktop platforms.
- Setup, configuration, testing, and packaging instructions are documented.

If a requirement cannot be fully implemented because of a provider limitation, missing credentials, licensing restrictions, or another external dependency, document the limitation and provide the best verifiable implementation possible. Do not silently substitute simulated functionality for a required live integration.

## 11. Implementation Guidelines

- Inspect the existing repository before making structural changes. If starting from an empty repository, establish the project structure deliberately.
- Follow existing conventions when extending an established project.
- Do not introduce additional infrastructure, libraries, or architectural complexity without a clear benefit.
- Use `class-validator` and `class-transformer` as the standard validation approach instead of maintaining duplicate Zod schemas.
- Make implementation decisions consistent with the architecture defined above.
- Verify each phase before moving to the next.
- Keep documentation aligned with the actual implementation.
- Clearly identify incomplete functionality and remaining work rather than claiming completion without verification.


## 12. Development Environment Concerns

- My PC C: drive is low on space, operate within the D: drive as much as possible. This includes hoisting Docker images on D: drive and whatever else could potentially take up space.