# Option Analytics Platform

A production-grade, responsive web platform for Indian options analytics with native Fyers and Dhan broker support. It uses a single-account session flow ensuring data routes through the connected broker.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, Zustand, Lightweight Charts, Recharts |
| Backend | FastAPI, Python 3.12+, Pydantic v2, SQLAlchemy 2, WebSockets |
| Analytics | Native TypeScript (Black-Scholes, Greeks, GBM Replay Engine) |
| Storage | PostgreSQL + TimescaleDB, Redis |
| Broker | Fyers SDK + Dhan API v2 adapter |
| Infra | Docker, GitHub Actions CI/CD |

## Quick Start

### Prerequisites
- Docker & Docker Compose
- A Fyers App ID and Secret Key (for TOTP auto-login or OAuth redirect login).
- Or a Dhan Client ID and current Dhan access token.

### Development

```bash
# Clone and start all services with frontend and backend hot reload
./start.sh

# Or run detached. Rebuild only after changing dependencies or a Dockerfile.
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up -d

# Backend only (development)
cd backend
poetry install
poetry run uvicorn app.main:app --reload --port 8001

# Frontend only (development)
cd frontend
npm install
npm run dev
```

When running Alembic natively, start the local Postgres container first:

```bash
./scripts/db-upgrade.sh
```

The Docker backend applies `alembic upgrade head` automatically after Postgres
is healthy. Set `RUN_MIGRATIONS=false` only when migrations are managed by a
separate deployment step.

The Docker development override bind-mounts `frontend/` and `backend/`, runs
`next dev` and Uvicorn reload, and refreshes source changes automatically at
`http://localhost:3001` and `http://localhost:8001`. Rebuild only after a
`package.json`, lockfile, `pyproject.toml`, or Dockerfile change. Use the base
compose file alone when you want production images
(`docker compose -f docker/docker-compose.yml up --build`).

### Environment Variables

Copy `.env.example` files in `backend/` and `frontend/` directories and configure:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### Connecting Dhan

Select **Dhan** on the login page, then enter your Dhan Client ID and the
access token generated in DhanHQ. Individual Dhan access tokens expire after
24 hours. Orders and portfolio data use Dhan's v2 API; when placing an order,
enter the instrument as `EXCHANGE_SEGMENT:SECURITY_ID` (for example
`NSE_EQ:11536`).

## Project Structure

```
├── backend/          # FastAPI Python backend
├── frontend/         # Next.js TypeScript frontend
├── docker/           # Docker Compose configuration
├── docs/             # Project documentation
├── .github/          # CI/CD workflows
└── agents/           # Agent skill definitions
```

## Documentation

- [Master Spec](docs/MASTER_SPEC.md) — Full feature requirements
- [Milestones](docs/MILESTONES.md) — Development history
- [Architecture](docs/Architecture.md) — Technical architecture
- [API Contracts](docs/API_CONTRACTS.md) — REST API definitions
- [Decisions](docs/DECISIONS.md) — Architecture decision records

## License

Private — All rights reserved.
