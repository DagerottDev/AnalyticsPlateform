export type RoadmapTier = "foundation" | "intermediate" | "advanced";

export type RoadmapArea =
  | "Data & Analytics"
  | "Trading & Portfolio"
  | "Alerts & Notifications"
  | "Platform & Infra"
  | "Testing"
  | "UX & Design";

export interface RoadmapItem {
  id: string;
  tier: RoadmapTier;
  area: RoadmapArea;
  title: string;
  description: string;
  /** Why this matters / the gap it closes — grounded in the current codebase, not generic advice. */
  why: string;
}

export interface RoadmapTierMeta {
  id: RoadmapTier;
  label: string;
  blurb: string;
}

export const ROADMAP_TIERS: RoadmapTierMeta[] = [
  {
    id: "foundation",
    label: "Foundation",
    blurb: "Quick wins — close known gaps and dead stubs in the existing UI.",
  },
  {
    id: "intermediate",
    label: "Intermediate",
    blurb: "Move real analytics server-side and make state durable across sessions.",
  },
  {
    id: "advanced",
    label: "Advanced",
    blurb: "New capabilities: execution, backtesting, multi-broker, and polish.",
  },
];

export const ROADMAP_ITEMS: RoadmapItem[] = [
  // ── Foundation ──────────────────────────────────────────────
  {
    id: "positions-page",
    tier: "foundation",
    area: "Trading & Portfolio",
    title: "Build the Positions page",
    description:
      "The sidebar already has a \"Positions\" nav item (disabled, href /positions) with no page behind it. Start with a paper-positions view derived from saved Strategy Builder trades.",
    why: "It's the single clearest known gap in the code — a nav stub pointing at nothing.",
  },
  {
    id: "real-vol-history",
    tier: "foundation",
    area: "Data & Analytics",
    title: "Replace the mocked volatility-history endpoint",
    description:
      "GET /volatility/{symbol}/historical currently returns a random.gauss random walk. Compute realized vol from real OHLCV history instead.",
    why: "IV Rank/Percentile on the Volatility page is built entirely on fabricated data today.",
  },
  {
    id: "option-chain-filters",
    tier: "foundation",
    area: "Data & Analytics",
    title: "Option Chain filters & export",
    description:
      "Add a moneyness/strike-count range filter, OI-change coloring vs. the previous snapshot, and a CSV export button.",
    why: "The chain table currently shows every strike with no way to narrow focus or take data out of the app.",
  },
  {
    id: "global-watchlist",
    tier: "foundation",
    area: "Trading & Portfolio",
    title: "Promote the ticker list to a global watchlist",
    description:
      "tickerStore.ts already tracks a symbol list, but it's scoped to the Dashboard only. Share it across Option Chain, Charts, Volatility, and Dealer Flow.",
    why: "Every other page makes you re-type the symbol; there's no single reusable watchlist.",
  },
  {
    id: "alert-presets",
    tier: "foundation",
    area: "Alerts & Notifications",
    title: "Alert templates & cooldown",
    description:
      "One-click presets (\"IV spike > 20%\", \"GEX flips negative\", \"breakout above VWAP\") plus a cooldown/snooze so a condition that stays true doesn't refire every tick.",
    why: "Today every alert is built field-by-field from scratch and can spam-trigger repeatedly.",
  },
  {
    id: "settings-page",
    tier: "foundation",
    area: "UX & Design",
    title: "Settings / Preferences page + light theme",
    description:
      "A dedicated settings page for default symbol, notification prefs, and a first light/dark theme toggle.",
    why: "There is no settings store or page at all today, and the app is hardcoded to dark mode.",
  },

  // ── Intermediate ────────────────────────────────────────────
  {
    id: "server-greeks-engine",
    tier: "intermediate",
    area: "Data & Analytics",
    title: "Port the Greeks/IV engine server-side",
    description:
      "lib/greeks.ts and lib/optionMath.ts (Black-Scholes, IV solver, Vanna/Charm) are solid but browser-only. Mirror them in the Python backend.",
    why: "Nothing server-side can evaluate Greeks today — alerts, backfill jobs, and future execution logic all need this.",
  },
  {
    id: "iv-snapshot-storage",
    tier: "intermediate",
    area: "Data & Analytics",
    title: "Persist daily IV snapshots",
    description:
      "Store computed ATM IV / IV Rank once per day so the volatility-history endpoint becomes a real accumulating time series.",
    why: "Builds directly on \"real-vol-history\" — without stored snapshots, IV Rank has no real history to rank against.",
  },
  {
    id: "market-data-backfill",
    tier: "intermediate",
    area: "Platform & Infra",
    title: "Market data backfill job",
    description:
      "The market_data Postgres table and /historical/ohlcv endpoint already exist, but nothing writes to the table. Add a scheduled job that backfills it from Fyers history.",
    why: "A whole persistence layer was built and migrated but is currently unused — the table is empty.",
  },
  {
    id: "portfolio-greeks",
    tier: "intermediate",
    area: "Trading & Portfolio",
    title: "Portfolio-level Greeks aggregation",
    description:
      "Aggregate net Delta/Gamma/Theta/Vega across all open positions/strategies, not just within a single Strategy Builder session.",
    why: "Greeks are currently computed per-strategy in isolation; there's no whole-book risk view.",
  },
  {
    id: "real-broker-positions",
    tier: "intermediate",
    area: "Trading & Portfolio",
    title: "Real broker positions/holdings/funds",
    description:
      "BrokerService has no get_positions/get_holdings/get_funds methods at all. Implement them on the Fyers adapter and surface on the Positions page.",
    why: "UserProfile.funds is hardcoded to None — the backend cannot see real account state today.",
  },
  {
    id: "paper-trading-sim",
    tier: "intermediate",
    area: "Trading & Portfolio",
    title: "Paper-trading simulator",
    description:
      "The Paper/Live toggle exists but today only changes a badge label. Give Paper mode real simulated fills and running P&L off Strategy Builder trades.",
    why: "\"Paper mode\" currently does nothing functional — it's cosmetic.",
  },
  {
    id: "server-side-alerts",
    tier: "intermediate",
    area: "Alerts & Notifications",
    title: "Server-side alert evaluation",
    description:
      "Persist alerts to the backend DB and evaluate them on a scheduler, instead of purely in the browser tab.",
    why: "alertStore is localStorage-only — alerts stop evaluating the moment the tab is closed.",
  },
  {
    id: "alert-delivery-channels",
    tier: "intermediate",
    area: "Alerts & Notifications",
    title: "Multi-channel alert delivery",
    description: "Add email, webhook, and Telegram/Slack delivery options alongside the existing in-app toast.",
    why: "The only notification path today is an in-app bell dropdown — nothing reaches you when the app isn't open.",
  },
  {
    id: "jwt-revocation",
    tier: "intermediate",
    area: "Platform & Infra",
    title: "JWT revocation (Redis blocklist)",
    description: "Add real server-side token invalidation on logout.",
    why: "The logout endpoint's own docstring flags this as a deferred \"M3\" item — JWTs aren't actually revocable today.",
  },
  {
    id: "rate-limiting",
    tier: "intermediate",
    area: "Platform & Infra",
    title: "Rate limiting middleware",
    description: "Add request rate limiting (e.g. slowapi) at the API layer.",
    why: "The code already documents Fyers' own 429 sensitivity with retry/backoff, but nothing protects this API's endpoints themselves.",
  },
  {
    id: "observability",
    tier: "intermediate",
    area: "Platform & Infra",
    title: "Structured logging & error tracking",
    description: "Request IDs, structured/JSON logs, and an APM/error tracker (e.g. Sentry).",
    why: "Logging today is plain unstructured Python logging with no correlation IDs and no error aggregation.",
  },
  {
    id: "component-test-coverage",
    tier: "intermediate",
    area: "Testing",
    title: "Page & component test coverage",
    description:
      "No tests exist for any page component, OptionChain, LegManager, PayoffChart, or Sidebar/Header. Also add backend tests for the volatility router and the headless-login flow — both untested.",
    why: "All 13 frontend test files are pure logic/lib tests; UI is entirely untested on both ends of the stack.",
  },

  // ── Advanced ────────────────────────────────────────────────
  {
    id: "vol-surface-model",
    tier: "advanced",
    area: "Data & Analytics",
    title: "Fit a real vol-surface model (SVI/SABR)",
    description: "Replace raw point interpolation in the IV smile/surface with a proper smile-fitting model.",
    why: "The current surface is a live interpolation of solved points, not a fitted, arbitrage-consistent model.",
  },
  {
    id: "backtest-engine",
    tier: "advanced",
    area: "Data & Analytics",
    title: "Strategy backtesting engine",
    description:
      "Run a strategy across a historical date range with simulated fills and real metrics (Sharpe, max drawdown, win rate) — distinct from Replay's single-session live-tick walk.",
    why: "Replay Mode only walks one session at real-ish speed; there's no way to test a strategy across months of history at once.",
  },
  {
    id: "monte-carlo-pop",
    tier: "advanced",
    area: "Data & Analytics",
    title: "Monte Carlo P&L simulation",
    description: "Probability-of-profit and P&L distribution for strategies in the Strategy Builder.",
    why: "Today the payoff chart shows one expected-value curve, not a distribution or probability of profit.",
  },
  {
    id: "relative-value-dashboard",
    tier: "advanced",
    area: "Data & Analytics",
    title: "Cross-instrument relative-value dashboard",
    description: "Compare skew/IV/GEX across NIFTY, BANKNIFTY, FINNIFTY, etc. side by side.",
    why: "Every analytics page today is scoped to one symbol at a time.",
  },
  {
    id: "order-placement",
    tier: "advanced",
    area: "Trading & Portfolio",
    title: "Real order placement",
    description: "Place/modify/cancel orders through Fyers' order API.",
    why: "This is a strictly read-only analytics app today — no execution path exists anywhere in the backend.",
  },
  {
    id: "trade-journal",
    tier: "advanced",
    area: "Trading & Portfolio",
    title: "Trade journal & performance analytics",
    description: "Log entries/exits with notes and tags; surface win rate, average R:R, and an equity curve.",
    why: "Natural extension once real fills exist (paper or live) — there's currently nowhere trade history is recorded.",
  },
  {
    id: "multi-broker",
    tier: "advanced",
    area: "Platform & Infra",
    title: "Second broker adapter",
    description: "broker_base.py already models a multi-broker abstraction. Add a second concrete adapter (Zerodha/Upstox/Angel One) to prove it out.",
    why: "Fyers is the only implementation today despite the abstraction already existing for more.",
  },
  {
    id: "multi-account",
    tier: "advanced",
    area: "Platform & Infra",
    title: "Multi-account / multi-session support",
    description: "Support multiple concurrently-linked broker accounts instead of one global session.",
    why: "SessionManager holds exactly one active BrokerService process-wide by design today.",
  },
  {
    id: "mobile-responsive",
    tier: "advanced",
    area: "UX & Design",
    title: "Mobile-responsive layouts",
    description: "Adapt key pages (chain, dashboard, alerts) for smaller screens.",
    why: "The app is desktop-dense by design today — dense tables and multi-column charts assume a wide screen.",
  },
  {
    id: "accessibility-pass",
    tier: "advanced",
    area: "UX & Design",
    title: "Accessibility pass",
    description: "Focus-ring audit, keyboard navigation, and screen-reader fallbacks for chart data.",
    why: "Charts (Recharts, lightweight-charts) currently have no non-visual fallback, and keyboard nav is unverified.",
  },
];
