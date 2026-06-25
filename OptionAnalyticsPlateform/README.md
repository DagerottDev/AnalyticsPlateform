# Option Analytics Platform

A production-grade, responsive web platform for Indian options analytics with multi-broker support through [OpenAlgo](https://openalgo.in).

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query |
| Backend | FastAPI, Python 3.12, WebSockets |
| Analytics | NumPy, Pandas, QuantLib, Numba |
| Storage | PostgreSQL + TimescaleDB, Redis |
| Broker | OpenAlgo (30+ Indian brokers) |
| Infra | Docker, GitHub Actions CI/CD |

## Quick Start

### Prerequisites
- Docker & Docker Compose
- OpenAlgo running locally (default: `http://127.0.0.1:5000`)

### Development

```bash
# Clone and start all services
docker compose -f docker/docker-compose.yml up -d

# Backend only (development)
cd backend
poetry install
poetry run uvicorn app.main:app --reload --port 8000

# Frontend only (development)
cd frontend
npm install
npm run dev
```

### Environment Variables

Copy `.env.example` files in `backend/` and `frontend/` directories and configure:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

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
