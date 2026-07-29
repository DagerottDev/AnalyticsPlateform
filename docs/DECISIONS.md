# Architecture Decisions

Append all major decisions here.

---

## ADR-001: Broker API Credentials as Authentication Identity
**Date:** 2026-06-26
**Status:** Accepted
**Context:** The platform needs user authentication but uses native broker APIs directly to connect the user to their trading account.
**Decision:** Use Broker credentials (App ID/API Key) as the sole authentication credential. No passwords stored. API key verification is done by fetching the broker profile. On success, a JWT session token is issued and the broker session is kept in-memory.
**Consequences:** Simple auth flow, no password management, relies on broker API availability.

---

## ADR-002: Zustand + TanStack Query for State Management
**Date:** 2026-06-26
**Status:** Superseded
**Context:** Need client-side state for auth/UI and server-side state for market data and analytics.
**Decision:** This was replaced by Zustand for client state and explicit Axios-backed API modules/hooks for server requests. TanStack Query is not a project dependency.
**Consequences:** The current data flow remains small and explicit; market subscriptions and polling are managed by the shared market-data hook and backend stream proxy.

---

## ADR-003: Tailwind v4 with Custom Design Tokens
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Architecture.md specifies Tailwind CSS. Need a premium, TradingView-inspired dark theme.
**Decision:** Tailwind v4 (latest) with `@theme` design tokens in globals.css. Custom color palette, glassmorphism utilities, gradient borders, and micro-animations.
**Consequences:** Modern CSS-first approach, no tailwind.config.ts needed, CSS variables for theming.

---

## ADR-004: API Versioning via URL Prefix
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Need future-proof API versioning.
**Decision:** URL-prefix versioning at `/api/v1/`. All routes are mounted under this prefix.
**Consequences:** Simple routing, explicit version in URLs, easy to add v2 without breaking v1.

---

## ADR-005: Poetry for Python Dependency Management
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Need reproducible Python dependency management with lockfile support and dev/test dependency groups.
**Decision:** Use Poetry with `pyproject.toml` as the single source of truth.
**Consequences:** Lockfile ensures deterministic builds, dependency groups keep production image smaller.

---

## ADR-006: Monorepo with Separate Docker Images
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Backend (Python) and frontend (Node.js) have different runtimes.
**Decision:** Monorepo with `backend/` and `frontend/` directories. Each has its own Dockerfile. Docker Compose orchestrates all services locally.
**Consequences:** Single repo for code review, shared CI/CD, independent deployments possible.

---

## ADR-007: Thick-Client Analytics (TypeScript Math Engine)
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Need sub-millisecond calculation of 1st, 2nd, and 3rd order Greeks as ticks arrive.
**Decision:** Build the Black-Scholes engine, Newton-Raphson IV solver, and Dealer Flow math in native TypeScript (`frontend/src/lib/greeks.ts`). Ticks are streamed directly to the browser, which computes everything locally.
**Consequences:** Zero backend latency. Scales infinitely (compute is offloaded to users). Removes need for Python QuantLib for live data.

---

## ADR-008: Local Geometric Brownian Motion for Replay Mode
**Date:** 2026-06-26
**Status:** Accepted
**Context:** User wants a Replay Mode to test strategies.
**Decision:** Do not download gigabytes of historical tick data. Use a TypeScript Geometric Brownian Motion (GBM) generator to mathematically simulate realistic underlying asset random walks. The TS Greek Engine dynamically prices the entire option chain based on the simulated spot.
**Consequences:** Replay is instant, works entirely offline, but requires synthetic assumptions instead of actual historical prints.
