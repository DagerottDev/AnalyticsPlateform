# PROJECT STATUS

Current Milestone:
- M10: Replay Mode — ✅ COMPLETE
- Post-M10 audit & correctness pass (2026-07-20) — ✅ COMPLETE (see below)
- Targeted quality refactor (2026-07-29) — ✅ COMPLETE (see below)
- Resilience & confidence quality pass (2026-07-30) — ✅ COMPLETE (see below)

## Server-backed user settings (2026-08-01)

- Settings now provide an authenticated, versioned preference profile with a
  local offline fallback and debounced server sync. Appearance, watchlist,
  charts/indicators, option-chain defaults, Greek layouts, replay defaults,
  per-symbol pricing rates, strategy defaults, and alert defaults move with
  the broker profile.
- Alert-delivery credentials remain in their separate encrypted settings API;
  resetting generic preferences never removes delivery channels, credentials,
  sessions, or orders.

## Option Chain basket orders (2026-08-01)

- Option Chain can now collect up to ten independent call/put legs into a basket, calculate broker margin, set side-aware per-leg premium stop/target prices, set combined ₹ P&L exits, and hand the editable legs to Strategy Builder in a new window.
- Paper baskets fill at current quotes and are protected by an app-mounted local monitor while the app is open. Live baskets submit market entries, wait for broker fill confirmation before arming exchange stops, and retain server-monitored premium targets/combined P&L exits.
- Legacy persisted basket `target` values remain interpreted as P&L targets; new requests use `target_price` for an option-premium target.

## Option Chain GTT orders (2026-08-01)

- The Option Chain ticket supports single-entry GTT orders with Buy/Sell trigger validation, MARKET or LIMIT execution, and a per-order expiry time. New tickets default to 30 days; Settings stores a user-editable default validity duration.
- Fyers GTTs are durable server-monitored orders. Dhan submits native `SINGLE` Forever Orders and the platform records/cancels them at expiry. Paper GTTs remain browser-resident and execute only while the app receives ticks.
- The Orders workspace lists GTT state and supports cancelling pending entries.

## Combined premium candle analysis (2026-08-01)

- Option Chain contract selection now opens a full-window Combined Premium Analysis workspace with raw-premium synthetic candles for selected Calls, selected Puts, and all selected contracts together.
- Each composite uses matching 5-minute broker candles from the preceding five days, sums OHLC/volume only where every component is present, receives live summed premium updates, and has independent indicator controls with EMA(20) enabled initially.

## Rolling ATM / OTM / ITM analysis selections (2026-08-01)

- Option Chain analysis selection now supports mixing fixed contracts with rolling `ATM`, `OTM 1–5`, and `ITM 1–5` Call/Put descriptors, within the same ten-selection limit.
- Rolling descriptors resolve against the active expiry's actual strike ladder at every underlying candle and live underlying update. Out-of-ladder selections remain unavailable instead of silently changing to a different strike.
- Greek and Combined Premium workspaces pass fixed symbols in `contracts` and validated descriptors in `dynamic`. Dynamic workspaces fetch the current market session only, resolve the source set before loading option history, limit that set to 40 contracts, and subscribe to the currently resolved contracts.
- The Greek inventory displays each rolling label and its current strike. Durable Greek alerts are disabled for rolling selections because server alerts are tied to a fixed broker contract.

## Selected Option Greek Analysis (2026-07-30)

- Option Chain now supports selecting up to ten individual call/put contracts and opening a shareable analysis workspace in a new window or tab.
- The full-width workspace compares Core Greeks (Delta, Gamma, Theta, Vega, Rho), higher-order Greeks (Vanna, Vomma, Charm, Speed, Color, Zomma, Ultima), and a selectable Greek-ratio chart against a base contract.
- Each visible Greek chart has its own focused contract and SMA, EMA, or Bollinger overlay. Durable server-side threshold alerts can be created for every supported individual option Greek directly from its chart.
- Contextual Info controls explain contract selection, dashboard aggregation, each Greek, overlays, and alert behaviour, with direct links to Options Industry Council learning material and glossary definitions.
- The workspace also has a desktop left-side, collapsible learning rail that explains the end-to-end workflow without reintroducing application navigation.

## Resilience & confidence quality pass (2026-07-30)

- Added explicit live, delayed, stale, and awaiting-quote states to dashboard, chart, and option-chain market data.
- Preserved raw API errors for recoverable order, journal, alert, and delivery-setting actions, with visible error details and safe retry paths.
- Made durable alert channels retry transient delivery failures with correlated, secret-safe structured logs; misconfigured enabled channels are now reported.
- Added rate-limit outcome logging and deterministic coverage for data freshness and transient delivery retries. Existing responsive layouts for the dashboard, alerts, charts, and chain retain usable controls and information hierarchy at narrow widths.
- Validated persisted broker sessions before scheduler startup, classified Fyers invalid-token responses, and made market/IV backfills clear dead sessions and stop quietly until reconnect.

## Dealer Flow open-interest correction (2026-07-30)

- Fixed empty GEX, Vanna, and Charm profiles caused by Fyers live ticks and quote snapshots reporting `open_interest: 0`. Dealer Flow now prefers a positive live OI value and falls back to the typed OI snapshot returned with each option-chain instrument.
- Added regression coverage for the fallback, including the case where a broker later supplies a live OI value.

## Targeted quality refactor (2026-07-29)

- Preserved the current API contracts while tightening SQLAlchemy mappings, broker/alert validation boundaries, and persisted literal-backed response values.
- Made backend test apps isolated by construction and exempted authenticated logout from the login-rate-limit bucket; login and auto-login remain rate limited.
- Refactored `useMarketData` subscriptions to diff added and removed symbols, with explicit cleanup for replay, logout, unmount, and Strict Mode remounts.
- Cleared frontend ESLint warnings and retained live-chart updates through stable refs rather than dependency suppressions.
- Verification: `eslint --max-warnings=0`, `tsc --noEmit`, frontend tests/build, Ruff, strict Mypy, and backend pytest are required to pass for this status (run results are recorded with the implementation handoff).

## Correctness & consistency quality pass (2026-07-30)

- Completed all six existing-flow improvements: typed market-data filtering, trade/order/portfolio serialization boundaries, persisted-alert lifecycle validation, session/replay/background lifecycle isolation, focused boundary regressions, and consistent keyboard/focus/chart-data fallbacks.

Completed:
- M1: Foundation
  - Monorepo structure (backend/ + frontend/)
  - FastAPI backend with Broker API auth (JWT)
  - Next.js 15 frontend with Tailwind v4 + Zustand
  - Premium TradingView-style dark theme
  - Docker Compose (backend, frontend, PostgreSQL+TimescaleDB, Redis)
  - GitHub Actions CI/CD pipeline
  - Backend tests (health + auth endpoints)
  - Frontend tests (auth types + utilities)

- M2: Market Data
  - Market data schemas and API endpoints (`/market/instruments`, `/market/expiries`)
  - Backend-mediated Fyers WebSocket proxy with reconnect handling and REST quote fallback
  - `useMarketData` React hook for live streaming ticks
  - Option Chain UI with Calls/Puts grid and ITM highlighting
  - Instrument selection (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) and expiry picker
  - *Correction:* the original mock-only implementation was replaced by the backend-mediated Fyers stream; REST quote polling remains available if the upstream stream is delayed.

- M3: Historical Engine
  - Database setup with SQLAlchemy and Alembic.
  - TimescaleDB hypertable migration for `market_data` (OHLCV).
  - Background job plumbing for fetching historical data from the Broker API.
  - Backend API endpoints (`/historical/backfill`, `/historical/ohlcv/{symbol}`).
  - *Correction:* the original wording here ("with mock fallback") implied a real broker fetch existed with mock as a fallback. In reality `FyersService.get_historical_data` was a hard stub returning `[]` unconditionally from M3 through M10 — the backfill endpoint accepted requests but never persisted real candles. It was implemented for real in the Post-M10 audit pass below.

- M4: Greek Engine
  - Pure TypeScript implementation of the Black-Scholes-Merton model.
  - Mathematical calculation of 1st-order Greeks (Delta, Gamma, Theta, Vega, Rho).
  - Newton-Raphson approximation for Implied Volatility backing out.
  - Dynamic real-time calculation and display of Greeks integrated directly into the `OptionChain` UI based on WebSocket ticks.
  - *Correction:* the 2nd/3rd-order Greeks (Vanna, Vomma, Charm, Speed, Color, Zomma, Ultima) were **not** actually implemented in M4 despite `FEATURE_MATRIX.md` marking them "✅ Done" at the time — they didn't exist in code at all until the Post-M10 audit pass below.

- M5: Charting
  - Integrated TradingView's `lightweight-charts`.
  - Built custom TypeScript math for technical indicators (SMA, EMA, RSI, Bollinger Bands).
  - Created interactive Historical OHLCV charts with dynamic live-tick appending.
  - Developed a high-performance strike-level Open Interest Heatmap.
  - Built the dedicated `/charts` dashboard.
  - Added durable, 30-second nearest-expiry Call/Put aggregate OI snapshots
    and live intraday OI time-series charts in `/open-interest`.

- M6: Volatility Analytics
  - Added `recharts` for complex 2D data plotting.
  - Built an endpoint generating 1-year Historical Volatility (IV vs RV) data.
  - Developed IV Rank (IVR) and IV Percentile (IVP) gauges.
  - Created the IV Smile chart (Strike vs IV) and Term Structure chart (Expiry vs ATM IV).
  - Designed a high-density IV Surface Heatmap using CSS Grid.

- M7: Dealer Flow
  - Mathematical implementation of Gamma Exposure (GEX), Zero Gamma, Call Walls, and Put Walls.
  - Created interactive `GEXProfileChart` visually separating Call (positive) and Put (negative) exposures.
  - Built the `/dealer-flow` dashboard with live price ticks and option-chain OI snapshots; Fyers tick OI is unavailable, so the chain snapshot is the exposure fallback.
  - *Correction:* Vanna and Charm Exposure were **not** actually implemented in M7 despite `FEATURE_MATRIX.md` marking them "✅ Done" at the time — the page imported functions that didn't exist and didn't compile (`tsc` failed outright) until the Post-M10 audit pass below implemented them for real.

- M8: Strategy Builder
  - Built `strategy.ts` math engine to calculate Payoff at Expiry and Theoretical Payoff (T+0).
  - Calculated aggregate portfolio Net Greeks (Delta, Gamma, Theta, Vega).
  - Developed `LegManager` UI to dynamically add, edit, and remove strategy legs (a generic multi-leg builder).
  - Created `PayoffChart` plotting intrinsic and T+0 curves with dynamic green/red profit zones.
  - Constructed the `/strategy` dashboard.
  - *Correction:* `docs/FEATURE_MATRIX.md` marked Iron Condor, Straddle, Strangle, Butterfly, Calendar, and Diagonal "✅ Done" as if each were a distinct implemented feature. In reality only the generic leg builder above existed — there was no preset/template code for any named strategy, and Calendar/Diagonal couldn't even be priced correctly (every leg shared one strategy-wide time-to-expiry, so multi-expiry spreads were mis-modeled). Real presets for all six were added in the Post-M10 audit pass below.

- M9: Alerts
  - Implemented Client-Side Alerting System using Zustand and LocalStorage.
  - Built `useAlertEngine` hook to evaluate conditions against real-time WebSocket ticks.
  - Supports Price, IV, Delta, Gamma, Theta, Vega, and GEX thresholds.
  - Integrated `sonner` for rich, global toast notifications.
  - Created the `/alerts` dashboard to manage active alerts and view trigger history.

- M10: Replay Mode
  - Built a full Geometric Brownian Motion (GBM) engine in TypeScript to mathematically simulate realistic full-day trading sessions.
  - Modified the core `useMarketData` hook to seamlessly intercept live WebSocket ticks and inject simulated Replay ticks.
  - Created the `/replay` configuration dashboard to set Underlying, Start Price, and Base IV.
  - Engineered a global, floating `ReplayController` (VCR-style) with Play/Pause, Timeline Scrubber, and 1x/5x/10x/100x Speed controls.
  - All existing dashboards (Charts, Dealer Flow, Greeks, Alerts) fully support the replay data out-of-the-box.

- Post-M10 audit & correctness pass (2026-07-20): the milestone bullets above (and `docs/FEATURE_MATRIX.md`) had drifted from what the code actually did — see the "*Correction:*" notes added retroactively to M2/M3/M4/M7 above. This pass audited `docs/FEATURE_MATRIX.md`/`docs/MASTER_SPEC.md` directly against the real implementation (deliberately not trusting this file's own prior claims as evidence) and found the frontend did not actually compile, plus several "✅ Done" rows that were markedly less complete than claimed. Fixed:
  - **Restored a green build.** `dealer-flow/page.tsx` called `calculateContractVannaExposure`/`calculateContractCharmExposure` (didn't exist) and read `greeks.vanna`/`greeks.charm` (didn't exist on `Greeks`) — `tsc --noEmit` was failing outright. `PayoffChart.tsx` read the wrong `PayoffPoint` field names. `StrategyMetrics.tsx` read net-Greeks fields that were never actually on its prop type (net Greeks were computed but never wired in as a typed prop) and crashed the `"Unlimited"` union case in `formatMoney`.
  - **Implemented the missing Greeks.** Of the 12 "done" Greeks, only delta/gamma/theta/vega/rho existed. Added vanna, vomma, charm, speed, color, zomma, ultima to `greeks.ts` with closed-form Black-Scholes formulas, each validated by a finite-difference cross-check test (bump S/T/sigma by ε, compare to the analytic derivative) rather than hand-typed reference numbers.
  - **Fixed Dealer Flow's Vanna/Charm Exposure** using the new Greeks (real formulas, same CE(+)/PE(-) sign convention as GEX) and deleted `calculateStrikeExposures` — dead code (zero callers) with a hardcoded `iv=0.15` and made-up `delta*0.5`/`theta*0.1` approximations standing in for vanna/charm.
  - **Fixed the Volatility page's data flow.** The frontend was calling `/volatility/historical/{symbol}` and `/volatility/metrics/{symbol}`; the backend actually serves `/volatility/{symbol}/historical` and `/volatility/{symbol}/metrics` — every real request 404'd and silently fell through to the frontend's `Math.random()` mock fallback. The declared TS types also didn't match the backend's real (snake_case) response shape. Both are now aligned, so IV Rank/Percentile/Historical charts show the backend's actual (still-synthetic-per-symbol, not live-market) data instead of always being client-side random numbers.
  - **Implemented the 9 missing indicators** MASTER_SPEC calls for (WMA, HMA, VWMA, Stochastic RSI, Supertrend, ATR, ADX, Donchian Channel, Z-score) in `indicators.ts`, each with a test — hand-computed where feasible, bounds/invariant-checked for the more complex ones (ADX verified against a hand-traced deterministic trending dataset). Wired EMA and Supertrend into the `/charts` UI as new overlay toggles; the other 7 are library-only (computable and tested, not yet chart-wired — see Known Issues).
  - **Gave Strategy Builder's named strategies real substance.** Iron Condor/Straddle/Strangle/Butterfly/Calendar/Diagonal previously had zero preset code — only a generic manual leg builder existed, and Calendar/Diagonal couldn't even be represented correctly (every leg shared one strategy-wide time-to-expiry). Added `strategyPresets.ts` with a real generator per strategy, wired a "Load Preset" control into `LegManager`, and changed `calculatePayoffProfile`/`calculateNetGreeks` to derive each leg's own T from its own instrument's expiry (proven correct with a test showing per-leg T changes the priced P&L vs. forcing one shared T).
  - **Implemented real historical candle fetching.** `FyersService.get_historical_data` now calls Fyers' actual `history()` API and parses `candles` rows (mocked in tests against the documented response shape) instead of unconditionally returning `[]` — the TimescaleDB backfill path (`/historical/backfill`) can now actually populate real data, not just accept and silently drop it.
  - Added a free-text stock-symbol field to `InstrumentSelector` alongside the 4 fixed indices, so "Stock F&O" is at least reachable (not a full searchable symbol master — see Known Issues).
  - Removed unused `@tanstack/react-query`; Redis remains configured for token revocation and Docker deployment.

In Progress:
- None

Pending:
- See "Known Issues" — the Tier 3 items below are deliberately deferred, not scheduled.

Known Issues:
- **Fyers option OI is snapshot-based.** Fyers live ticks and REST quotes do not provide option OI. The option-chain response supplies OI on a short cache TTL, and Dealer Flow uses that snapshot when a live OI value is absent.
- **Dhan does not expose a Fyers-compatible option-chain-by-symbol API.** The Dhan adapter supports authenticated account, order, portfolio, and explicit-security quote flows; chain-driven analytics require a connected Fyers session.
- **Replay engine's OI and IV are not truly simulated.** `replayEngine.ts` uses a real GBM (Geometric Brownian Motion) process for Price, but Open Interest is a static `10000 + strike*5` formula (no time variance) and IV is a single constant fed into every tick for the whole session (no smile/skew/vol-of-vol dynamics). "Greeks replay" isn't generated by the replay engine either — it's recomputed generically downstream from the simulated price, the same code path used in live mode.
- **7 of the 13 MASTER_SPEC indicators are library-only.** WMA, HMA, VWMA, Stochastic RSI, ATR, ADX, and Donchian Channel are implemented and tested in `indicators.ts` but not wired into the `/charts` UI (only SMA, EMA, Bollinger, RSI, and now Supertrend are chart-toggleable).
- **Dual-axis comparison charts and multi-strike price overlays** (both named in `MASTER_SPEC.md`'s Visualization section, absent from `FEATURE_MATRIX.md` entirely) are not implemented anywhere.
- **Volatility history begins with a realized-volatility proxy until sufficient daily ATM-IV snapshots accumulate.** The backend derives realized volatility from broker daily candles and persists one ATM-IV observation per day when a live option pair is available.
- **Quality checks**: the targeted refactor resolved the previous ESLint warning set and strict Mypy findings. The supported verification commands are listed in the 2026-07-29 quality-pass section above.
- A prior audit (2026-07-06) found and fixed a batch of regressions left over from the OpenAlgo → native broker SDK migration (2f06dfb, acff4bf) — retained here for history: a syntax error that prevented the backend from importing at all, a double-prefixed API router, a dead `openalgo_host` field reference, an undefined `tradingSymbols` reference crashing `/chain`, and a missing `calculateOptionPrice` export.

Next Actions:
- Verify the current Fyers option-chain and stream behavior against production credentials on each SDK upgrade, especially the OI snapshot fields used by Dealer Flow.
- Wire the remaining 7 library-only indicators into the `/charts` UI if there's demand for them beyond SMA/EMA/Bollinger/RSI/Supertrend.

Tech Stack Locked:
- Backend: FastAPI + Python 3.12 + Poetry
- Frontend: Next.js 15 + TypeScript + Tailwind v4 + Zustand + Lightweight Charts + Recharts + Sonner
- Database: PostgreSQL + TimescaleDB
- Cache: Redis (provisioned in `docker-compose`, intentionally not a backend dependency — nothing in the codebase consumes it)
- Broker: Native Fyers SDK and Dhan API v2 adapter
- CI/CD: GitHub Actions
- Container: Docker + Docker Compose

IMPORTANT:
Update this file after every completed task or milestone.
