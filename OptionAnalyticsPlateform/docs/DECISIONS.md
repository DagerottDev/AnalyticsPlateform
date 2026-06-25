# Architecture Decisions

Append all major decisions here.

---

## ADR-001: OpenAlgo API Key as Authentication Identity
**Date:** 2026-06-26
**Status:** Accepted
**Context:** The platform needs user authentication but OpenAlgo is self-hosted and users authenticate through their broker's login flow within OpenAlgo.
**Decision:** Use OpenAlgo API key as the sole authentication credential. No passwords stored. API key verification is done by calling OpenAlgo's `/api/v1/funds` endpoint. On success, a JWT session token is issued.
**Consequences:** Simple auth flow, no password management, but requires OpenAlgo to be running for login.

---

## ADR-002: Zustand + TanStack Query for State Management
**Date:** 2026-06-26
**Status:** Accepted
**Context:** Need client-side state for auth/UI and server-side state for market data and analytics.
**Decision:** Zustand for client state (auth, UI preferences, sidebar state). TanStack Query for server state (API calls, caching, real-time data). No Redux.
**Consequences:** Small bundle, simple APIs, built-in cache invalidation. TQ handles refetching, polling, and stale-while-revalidate out of the box.

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
