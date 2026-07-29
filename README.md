# Option Analytics Platform

A production-grade, responsive web platform for Indian options analytics with native Fyers and Dhan broker support. It uses a single-account session flow ensuring data routes through the connected broker.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query |
| Backend | FastAPI, Python 3.12, WebSockets |
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
# Clone and start all services with frontend hot reload
./start.sh

# Or run detached
docker compose -f docker/docker-compose.yml -f docker/docker-compose.dev.yml up --build -d

# Backend only (development)
cd backend
poetry install
poetry run uvicorn app.main:app --reload --port 8001

# Frontend only (development)
cd frontend
npm install
npm run dev
```

The Docker development override bind-mounts `frontend/` and runs `next dev`,
so frontend source changes refresh automatically at `http://localhost:3001`.
Use the base compose file alone only when you want the production frontend
image (`docker compose -f docker/docker-compose.yml up --build`).

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
- [Milestones](docs/MILESTONES.md) — Development roadmap
- [Architecture](docs/Architecture.md) — Technical architecture
- [API Contracts](docs/API_CONTRACTS.md) — REST API definitions
- [Decisions](docs/DECISIONS.md) — Architecture decision records

## License

Private — All rights reserved.
