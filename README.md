<a id="readme-top"></a>

[![Next.js][next-shield]][next-url]
[![TypeScript][typescript-shield]][typescript-url]
[![FastAPI][fastapi-shield]][fastapi-url]
[![Python][python-shield]][python-url]
[![Containers][container-shield]][container-url]
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<div align="center">
  <h1>Option Analytics Platform</h1>
  <p>A web workspace for Indian options research, broker-connected market data, strategy analysis, and paper or live trading.</p>
  <p>
    <a href="docs/Architecture.md">Architecture</a>
    &middot;
    <a href="docs/API_CONTRACTS.md">API documentation</a>
    &middot;
    <a href="https://github.com/DagerottDev/AnalyticsPlateform/issues/new/choose">Report a bug or request a feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ul>
    <li><a href="#about-the-project">About The Project</a>
      <ul><li><a href="#built-with">Built With</a></li></ul>
    </li>
    <li><a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#configuration">Configuration</a></li>
        <li><a href="#native-development">Native Development</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#data-and-trading-constraints">Data and Trading Constraints</a></li>
    <li><a href="#development-and-checks">Development and Checks</a></li>
    <li><a href="#troubleshooting">Troubleshooting</a></li>
    <li><a href="#project-structure-and-documentation">Project Structure and Documentation</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ul>
</details>

## About The Project

Option Analytics Platform brings option-chain research, Greek exposure, volatility analysis, and trading workflows into one responsive dashboard. It is intended for users researching Indian index and stock options with their own Fyers or Dhan account.

Implemented workspaces include:

- **Option Chain:** expiry and strike selection, call/put comparisons, baskets, and single-entry GTT tickets.
- **Greek and premium analysis:** compare up to ten selected contracts, use fixed or rolling ATM/OTM/ITM selections, and inspect core and higher-order Greeks or combined premium charts.
- **Charts and Open Interest:** historical and live price charts, SMA/EMA/Bollinger/RSI/Supertrend controls, and captured OI profiles and time series.
- **Volatility and Relative Value:** IV smile, surface and term-structure views, realized-versus-implied comparisons, and an F&O IV screener with snapshot freshness and readiness states.
- **Dealer Flow and Market Structure:** gamma, vanna and charm exposure, OI concentration, and explicitly labeled scenario assumptions.
- **Participant Flow:** daily NSE participant OI and trading-volume reports, available independently of a broker login.
- **Strategy Builder and Replay:** strategy presets, custom legs, payoff and net-Greek calculations, Monte Carlo analysis, backtesting, and historical-candle replay with modeled fallbacks.
- **Trading and preferences:** paper/live modes, orders, positions, a trade journal, persisted alerts, and server-synced settings with a local fallback.

The backend runs one worker and holds one active broker connection per API process. Connecting another account replaces the previous session; this is a single-account workspace.

### Built With

| Layer | Technologies |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand |
| Visualization | Lightweight Charts, Recharts |
| Backend | Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic |
| Analytics | TypeScript and Python option-pricing/Greek calculations |
| Storage | PostgreSQL 16 with TimescaleDB; Redis for JWT revocation |
| Brokers | Fyers API v3 SDK; Dhan API v2 adapter |
| Development | Podman Compose (or Docker Compose), npm, Poetry, Vitest, Pytest, Ruff, Mypy, ESLint |
| Automation | [GitHub Actions checks](.github/workflows/ci.yml) |

<p align="right"><a href="#readme-top">Back to top</a></p>

## Getting Started

Run from source with Podman Compose, or run the application natively while containers supply PostgreSQL and Redis. This is a self-hosted, single-account workspace. Start in paper mode; broker-backed data requires your own authorized account.

### Prerequisites

- Git and the source from [DagerottDev/AnalyticsPlateform][repo-url].
- Bash and OpenSSL for `install.sh` (on Windows, use WSL).
- Podman with a Compose provider (`podman compose version`). On macOS/Windows, start your Podman machine first. Docker Compose can also run the supplied Compose files.
- For broker-backed analytics: a Fyers app ID and secret with either OAuth authorization or client ID, PIN and TOTP secret; alternatively, a Dhan client ID and a current access token.
- For native development only: Python **3.12**, Poetry **2.4.1**, and Node.js **24** with npm, matching the Dockerfiles and CI configuration.

Broker access and data availability determine which workspaces can load market data. See [Data and Trading Constraints](#data-and-trading-constraints) before choosing a broker.

### Installation

For a fresh checkout:

```bash
git clone https://github.com/DagerottDev/AnalyticsPlateform.git
cd AnalyticsPlateform
./install.sh
podman compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build
```

The installer creates missing environment files with distinct random signing/encryption keys and mode 0600. It preserves existing environment files. Existing installations must replace a placeholder or short `JWT_SECRET` before upgrading; keep any existing encryption key. The Compose command builds and starts the four-service development stack with frontend and backend hot reload. The existing `start.sh` helper uses Docker; the commands here use Podman directly. The backend waits for PostgreSQL and runs `alembic upgrade head` before starting the API.

| Service | Local address |
| --- | --- |
| Web application | <http://localhost:3001> |
| Backend health | <http://localhost:8001/api/v1/health> |
| Swagger UI, in development | <http://localhost:8001/api/docs> |
| ReDoc, in development | <http://localhost:8001/api/redoc> |
| PostgreSQL | `localhost:5433` |
| Redis | `localhost:6380` |

To run development services in the background:

```bash
podman compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build -d
```

Source changes hot reload. Rebuild after dependency, lockfile, Dockerfile, or entrypoint changes. Development dependency volumes persist between runs; recreate the affected dependency volume if it still contains an older installed dependency set, while preserving the database volume.

### Configuration

The committed [backend example](backend/.env.example) and [frontend example](frontend/.env.example) document local settings. Supply broker credentials through **Accounts**, not environment variables.

| Variable | Purpose / local value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Browser-facing API base, `http://localhost:8001` |
| `DATABASE_URL` | Native backend: `postgresql+asyncpg://postgres:postgres@localhost:5433/option_analytics` |
| `REDIS_URL` | Native backend: `redis://localhost:6380/0` |
| `JWT_SECRET` | Required independently generated signing secret, at least 32 characters; shipped placeholders are rejected |
| `JWT_ALGORITHM`, `JWT_EXPIRY_MINUTES` | Application token settings, default `HS256` and `480` |
| `APP_ENV`, `APP_DEBUG`, `CORS_ORIGINS` | Local defaults: `development`, `false`, `http://localhost:3001` |
| `BROKER_TOKEN_ENCRYPTION_KEY` | Optional Fernet key for persisted broker secrets; without it, persistence is plaintext |
| `MARKET_QUOTE_POLL_INTERVAL_SECONDS` | REST fallback polling interval, default `3.0` seconds |
| `API_RATE_LIMIT_BROKER_REQUESTS` | Broker-route budget, default `120` per client IP per minute |
| `MARKET_DATA_BACKFILL_ENABLED`, `MARKET_DATA_BACKFILL_SYMBOLS` | Scheduled daily candle storage, default `true` and `NIFTY,BANKNIFTY` |
| `LOG_LEVEL`, `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | Optional logging and error reporting |

**Container environment handling:** Compose loads `backend/.env` through `env_file` and overrides only container database/cache addresses and migration control. Configure `JWT_SECRET`, encryption, `APP_ENV`, debug and CORS in that file. All published ports bind to `127.0.0.1`. Build-context ignore files exclude local environment files; production images use the configured runtime environment. Set `NEXT_PUBLIC_API_URL` in the Compose shell before building to supply the frontend build argument; runtime changes do not rewrite the client bundle.

`RUN_MIGRATIONS=false` skips the container migration step only when migrations are handled separately. To build production images locally, use the base Compose file alone:

```bash
podman compose -f docker/docker-compose.yml up --build -d
```

That file retains local database credentials; use deployment-specific database credentials and a TLS reverse proxy before use on a server. Set the browser API URL at frontend **build time** for production: `NEXT_PUBLIC_*` values are bundled into the client, and runtime-only changes do not rewrite that build. See [Deployment](docs/DEPLOYMENT.md), checking its examples against the current Compose files and ports.

Recovery requires an existing unexpired, nonrevoked browser JWT bound to the same account, broker and trading mode. Expired or missing browser tokens require manual broker login. The login form saves credentials, including PIN/TOTP fields and Dhan tokens, in browser local storage for reuse. Use a trusted browser profile. Database encryption does not encrypt these browser values.

### Native Development

After creating the environment files above, start infrastructure and install backend dependencies from the repository root:

```bash
podman compose -f docker/docker-compose.yml up -d --wait postgres redis
cd backend
poetry install
poetry run alembic upgrade head
cd ..
```

Wait for PostgreSQL to become healthy before applying migrations. The older `scripts/db-upgrade.sh` helper starts infrastructure through Docker; the commands above use Podman directly. In separate terminals, from the repository root:

```bash
# Backend
cd backend
poetry run uvicorn app.main:app --reload --port 8001
```

```bash
# Frontend
cd frontend
npm ci
npm run dev
```

Install frontend dependencies inside `frontend/`, using its committed npm lockfile. Native development uses the same browser and API addresses as container development. The optional `install.sh` helper creates missing environment files and installs native dependencies when Poetry/npm are available; its frontend step uses `npm ci`.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Usage

For a first option-chain research session:

1. Open <http://localhost:3001>. The home route takes you to **Accounts**.
2. Select **Fyers** and keep **Paper** mode selected. Use **TOTP Auto-Login** with the fields shown, or **OAuth Redirect** with your registered redirect URI and the returned authorization code.
3. Once connected, open **Option Chain**, select **NIFTY** and an available expiry, then choose call/put contracts.
4. Select up to ten contracts to open Greek Analysis or Combined Premium Analysis. Inspect the quote freshness labels and each chart's contract selection.
5. Open **Strategy Builder** to load a preset or review custom legs, modeled payoff and net Greeks. Paper mode simulates execution; live mode can submit real broker orders.

For **Dhan**, select it in Accounts and enter your client ID and current DhanHQ access token. The login form notes a 24-hour lifetime for individual tokens; reconnect with a fresh token when needed. Its current option-chain mapping covers **NIFTY only**. Explicit order and quote identifiers use `EXCHANGE_SEGMENT:SECURITY_ID`, such as `NSE_EQ:11536`; verify the security ID for the intended instrument.

For **Replay Mode**, choose an underlying, session date, expiry, strike, option side and playback speed. The application fetches historical underlying candles, attempts to enrich nearby options with real contract candles, and uses modeled prices where candles are unavailable. A closed market date or unavailable broker history cannot produce a real replay session.

The **Participant Flow** workspace reads stored daily NSE reports without requiring a connected broker. An unpublished report is shown as unavailable and retried by the backend worker.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Data and Trading Constraints

- **Broker coverage differs.** Fyers supplies the broader symbol-based chain, streaming and option-history paths. Dhan's adapter maps only NIFTY option chains, supports explicit-security quotes, account/order/portfolio operations and native Forever Orders, and has a historical-chart path for index/equity identifiers. It does not provide equivalent intraday option-history coverage for all analytics.
- **Fyers OI is snapshot-based.** Live ticks and REST quotes do not supply option OI. Dealer Flow falls back to the option-chain OI snapshot; captured OI history begins with observations stored by this installation.
- **IV history has provenance limits.** Volatility history uses a realized-volatility proxy until daily ATM-IV observations are available. The IV screener tracks building/ready/stale rows and needs sufficient true daily IV observations for rank and percentile; startup alone does not imply populated history.
- **Replay mixes observed and modeled data.** Historical candles drive the underlying. Missing option candles retain Black–Scholes prices at the configured fallback volatility; those modeled ticks have zero option volume and OI. Replay does not reconstruct historical exchange ticks or independently simulate IV/OI paths.
- **Exposure assumptions are visible.** Greek scenarios and dealer sign assumptions are analytical models, not observations of dealers' actual positions. Market Structure labels OI concentration and scenario assumptions separately.
- **Monitors need to remain running.** Paper baskets and paper GTT orders depend on the open application and incoming ticks. Fyers GTT triggers, live basket targets and combined P&L exits depend on backend monitors. Protective per-leg exchange stops are submitted after entry-fill confirmation; backend-monitored exits cannot fire while the process is down.
- **Specification coverage is incomplete.** Several indicators exist only in the calculation library, and the project records remaining comparison-chart gaps. Browser E2E and performance/load suites are not implemented. Consult the source and [Project Status](docs/PROJECT_STATUS.md) alongside the historical [Feature Matrix](docs/FEATURE_MATRIX.md).

<p align="right"><a href="#readme-top">Back to top</a></p>

## Development and Checks

Run frontend checks inside `frontend/` after `npm ci`:

```bash
cd frontend
npx eslint src --max-warnings=0
npx tsc --noEmit
npm test
npm run build
```

`npm run test:watch` starts interactive Vitest. `npm run lint` runs the same ESLint check used in CI.

To serve a native production frontend after building, from `frontend/`:

```bash
npm run start -- --port 3001
```

Run backend checks inside `backend/` after `poetry install`:

```bash
cd backend
poetry run ruff check .
poetry run mypy app/ --ignore-missing-imports
poetry run pytest
```

Backend fixtures use isolated SQLite databases and mocked broker services for endpoint tests. Running the application and its migrations still requires PostgreSQL/TimescaleDB. The [testing guide](docs/TESTING_STRATEGY.md) describes suite scope; its older live-Postgres fixture note differs from the current fixtures.

The [CI workflow](.github/workflows/ci.yml) defines backend/frontend checks and Docker image validation. These commands describe the project's verification tools, not a claim that every check currently passes.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Podman cannot connect or Compose is unavailable | Start your Podman machine and install a Compose provider; check `podman info` and `podman compose version`. |
| Native migrations cannot connect | Confirm PostgreSQL is healthy and native `DATABASE_URL` uses host port `5433`, then run `poetry run alembic upgrade head` inside `backend/`. |
| Browser API requests fail | Confirm the backend is on `8001`, `NEXT_PUBLIC_API_URL` matches, and CORS allows `http://localhost:3001`. Restart the development frontend after environment changes. |
| Swagger URL returns 404 | Use `/api/docs`; interactive docs are enabled only in development mode. |
| Broker session is lost or expired | Reconnect through Accounts. Saved Fyers TOTP credentials may support automatic recovery; Dhan requires a valid current token. |
| A Dhan underlying has no expiries | The adapter currently maps only NIFTY. Use Fyers for the broader chain workflow. |
| IV screener is building or stale | Check valid Fyers access, worker logs and available historical option candles; otherwise true IV history must accumulate over time. |
| API returns 429 | Inspect the full error and retry timing; reduce concurrent requests before adjusting broker-route budgets or quote polling. |
| Dependency changes do not appear in Docker | Rebuild and check the persisted development dependency volume, preserving stored market data. |

View development backend logs from the root:

```bash
podman compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml logs -f backend
```

The UI includes an API error log and copyable error details. Include the relevant error when reporting a problem, after removing any private credentials or account data.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Project Structure and Documentation

```text
backend/     FastAPI routes, broker adapters, persistence, workers and Pytest tests
frontend/    Next.js pages, charts, analytics libraries, stores and Vitest tests
docker/      Base Compose stack and development hot-reload override
scripts/     Database migration helper
docs/        Architecture, specifications, status and operational guides
.github/     GitHub Actions workflow
agents/      Project agent skill definitions
.agents/     Repository instructions
```

| Document | Purpose |
| --- | --- |
| [Architecture](docs/Architecture.md) | Frontend, backend, broker and storage responsibilities |
| [API Contracts](docs/API_CONTRACTS.md) | Documented REST interfaces; development Swagger reflects current routes |
| [Database Schema](docs/DATABASE_SCHEMA.md) | Storage overview; Alembic migrations define the current schema |
| [Deployment](docs/DEPLOYMENT.md) | Deployment and maintenance guidance; verify environment and port examples against current files |
| [Testing Strategy](docs/TESTING_STRATEGY.md) | Test coverage and unimplemented suites |
| [Coding Standards](docs/CODING_STANDARDS.md) | Project coding conventions |
| [Design System](docs/DESIGN_SYSTEM.md) | Midnight Exchange theme, semantic tokens and UI conventions |
| [Project Status](docs/PROJECT_STATUS.md) | Implementation history and known constraints |
| [Master Spec](docs/MASTER_SPEC.md), [Feature Matrix](docs/FEATURE_MATRIX.md), [Milestones](docs/MILESTONES.md) | Requirements and historical milestone tracking |
| [Decisions](docs/DECISIONS.md), [Tech Stack](docs/TECH_STACK.md) | Architectural choices and stack notes |

<p align="right"><a href="#readme-top">Back to top</a></p>

## Contributing

Contributions are welcome through [issues][issues-url] and pull requests. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, and contribution expectations, and follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using the [security reporting instructions](.github/SECURITY.md).

<p align="right"><a href="#readme-top">Back to top</a></p>

## License

Original project code is available under the [MIT License](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). The code license does not grant redistribution rights for broker or exchange data.

See the [open-source release checklist](docs/OPEN_SOURCE_READINESS.md) for verification results and remaining publication steps.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Contact

Use the [repository][repo-url] and its [issue tracker][issues-url] for project support.

<p align="right"><a href="#readme-top">Back to top</a></p>

## Acknowledgments

- [Fyers](https://myapi.fyers.in/) and [DhanHQ](https://dhanhq.co/) for broker APIs.
- [Lightweight Charts](https://github.com/tradingview/lightweight-charts) and [Recharts](https://recharts.org/) for charting.
- README layout inspired by [Best-README-Template](https://github.com/othneildrew/Best-README-Template).

<p align="right"><a href="#readme-top">Back to top</a></p>

[repo-url]: https://github.com/DagerottDev/AnalyticsPlateform
[issues-url]: https://github.com/DagerottDev/AnalyticsPlateform/issues
[next-shield]: https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[next-url]: https://nextjs.org/
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[fastapi-shield]: https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white
[fastapi-url]: https://fastapi.tiangolo.com/
[python-shield]: https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white
[python-url]: https://www.python.org/
[container-shield]: https://img.shields.io/badge/Podman-892CA0?style=for-the-badge&logo=podman&logoColor=white
[container-url]: https://podman.io/
