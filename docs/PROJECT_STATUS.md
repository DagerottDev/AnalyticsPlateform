# PROJECT STATUS

Current Milestone:
- M10: Replay Mode — ✅ COMPLETE
- Post-M10 audit & correctness pass (2026-07-20) — ✅ COMPLETE (see below)

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
  - Simulated WebSocket client (`MockWebSocketClient`) with reconnect handling
  - `useMarketData` React hook for live streaming ticks
  - Option Chain UI with Calls/Puts grid and ITM highlighting
  - Instrument selection (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY) and expiry picker
  - *Correction:* the original wording here ("mock fallback") implied a real broker WebSocket path exists and mock is the fallback. In reality there has never been a real Fyers WebSocket connection anywhere in the codebase — it's mock-only. See Known Issues below.

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

- M6: Volatility Analytics
  - Added `recharts` for complex 2D data plotting.
  - Built an endpoint generating 1-year Historical Volatility (IV vs RV) data.
  - Developed IV Rank (IVR) and IV Percentile (IVP) gauges.
  - Created the IV Smile chart (Strike vs IV) and Term Structure chart (Expiry vs ATM IV).
  - Designed a high-density IV Surface Heatmap using CSS Grid.

- M7: Dealer Flow
  - Mathematical implementation of Gamma Exposure (GEX), Zero Gamma, Call Walls, and Put Walls.
  - Created interactive `GEXProfileChart` visually separating Call (positive) and Put (negative) exposures.
  - Built the `/dealer-flow` dashboard unifying these metrics with live WebSocket data.
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
  - Removed `@tanstack/react-query` (frontend) and `redis`/`redis_url` (backend) — both were unused dependencies flagged in a prior audit; this executes the "remove" side of that decision.

In Progress:
- None

Pending:
- See "Known Issues" — the Tier 3 items below are deliberately deferred, not scheduled.

Known Issues:
- **`FyersService.get_instruments` (option-chain / instrument-master fetching) is still a stub returning `[]`.** Fyers' real `optionchain()` response shape was only corroborated via web search of community posts, not an official verified schema or a live test account — implementing it against a guessed shape risked shipping exactly the kind of "looks done, silently wrong" code this audit exists to catch, so it was deliberately left alone rather than guessed at. Concretely this means: expiries, multi-strike option-chain data, and anything downstream of it (Option Chain, Heatmaps, IV Smile/Surface, Dealer Flow, Strategy Builder leg selection) run on the frontend's mock-data fallback in a real (non-mock) session, not live broker data.
- **Real broker WebSocket streaming is not implemented.** `frontend/src/lib/websocket.ts`'s `MockWebSocketClient` synthesizes random-walk ticks; no code anywhere (frontend or backend) opens a real Fyers WebSocket connection. This needs a backend-mediated WS proxy (a Fyers access token can't safely go to the browser) — a real architecture item, not a quick fix.
- **Stock F&O selection is a free-text field, not a searchable symbol master.** You can type a symbol, but there's no lookup/autocomplete against Fyers' actual instrument list (which itself depends on the `get_instruments` gap above).
- **Replay engine's OI and IV are not truly simulated.** `replayEngine.ts` uses a real GBM (Geometric Brownian Motion) process for Price, but Open Interest is a static `10000 + strike*5` formula (no time variance) and IV is a single constant fed into every tick for the whole session (no smile/skew/vol-of-vol dynamics). "Greeks replay" isn't generated by the replay engine either — it's recomputed generically downstream from the simulated price, the same code path used in live mode.
- **7 of the 13 MASTER_SPEC indicators are library-only.** WMA, HMA, VWMA, Stochastic RSI, ATR, ADX, and Donchian Channel are implemented and tested in `indicators.ts` but not wired into the `/charts` UI (only SMA, EMA, Bollinger, RSI, and now Supertrend are chart-toggleable).
- **Dual-axis comparison charts and multi-strike price overlays** (both named in `MASTER_SPEC.md`'s Visualization section, absent from `FEATURE_MATRIX.md` entirely) are not implemented anywhere.
- **Volatility data is backend-synthetic, not live-market.** `backend/app/api/v1/volatility.py`'s historical IV/RV series is a `random.gauss` random walk per symbol, not derived from real market data — the routing/field-mismatch bug that made it *worse* (silently falling back to an even-more-random frontend mock) is fixed, but the underlying data source itself is still synthetic.
- `@tanstack/react-query` and `redis` — resolved. Both were unused dependencies; removed from `frontend/package.json` and `backend/pyproject.toml` respectively (Redis stays provisioned in `docker-compose` for future use, just not wired into any backend code path).
- **Pre-existing lint/type debt outside this pass's scope**: `next lint` currently reports ~146 problems (mostly `@typescript-eslint/no-explicit-any` and unused-var warnings) across files this pass didn't touch (`websocket.ts`, `replayEngine.ts`, `ApiErrorDisplay.tsx`, several component files); `mypy app` reports 7 pre-existing errors, nearly all "missing type stubs for a third-party package" (`fyers_apiv3`, `jose`, `requests`) rather than real type errors. Neither blocks `tsc --noEmit`, `pytest`, or `vitest`, all of which are genuinely green as of this pass — but the earlier claim in this file that `next lint`/`mypy --strict` were green was not accurate, and is corrected here rather than repeated.
- A prior audit (2026-07-06) found and fixed a batch of regressions left over from the OpenAlgo → native broker SDK migration (2f06dfb, acff4bf) — retained here for history: a syntax error that prevented the backend from importing at all, a double-prefixed API router, a dead `openalgo_host` field reference, an undefined `tradingSymbols` reference crashing `/chain`, and a missing `calculateOptionPrice` export.

Next Actions:
- If live Fyers credentials become available: verify the real `optionchain()` response shape against a live account, then implement `get_instruments`/`get_expiries` for real (the option-chain item above is the single highest-leverage remaining gap — nearly every other "mock data" symptom traces back to it).
- Decide whether real broker WebSocket streaming is worth the backend WS-proxy architecture, or whether the mock feed is acceptable for the platform's actual use case.
- Wire the remaining 7 library-only indicators into the `/charts` UI if there's demand for them beyond SMA/EMA/Bollinger/RSI/Supertrend.
- Optionally address the pre-existing `next lint`/`mypy` debt noted above (unrelated to this pass's scope, but real accumulated backlog).

Tech Stack Locked:
- Backend: FastAPI + Python 3.12 + Poetry
- Frontend: Next.js 15 + TypeScript + Tailwind v4 + Zustand + Lightweight Charts + Recharts + Sonner
- Database: PostgreSQL + TimescaleDB
- Cache: Redis (provisioned in `docker-compose`, intentionally not a backend dependency — nothing in the codebase consumes it)
- Broker: Native SDK (Fyers only — Zerodha support was removed; see `backend/app/services/fyers_service.py` / `fyers_headless.py`)
- CI/CD: GitHub Actions
- Container: Docker + Docker Compose

IMPORTANT:
Update this file after every completed task or milestone.
