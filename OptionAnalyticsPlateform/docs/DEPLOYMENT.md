# Deployment & Setup Guide

This document outlines how to run the Option Analytics Platform locally for development and how to deploy it to a production server (VPS, AWS EC2, DigitalOcean, etc.).

---

## 1. Local Development Setup

You can run the application locally in two ways: fully via Docker (recommended for easiest setup) or natively (recommended for active development).

### Option A: Fully Dockerized (Easiest)

This approach spins up the Backend, Frontend, PostgreSQL (TimescaleDB), and Redis automatically.

1. **Prerequisites**: Ensure [Docker](https://docs.docker.com/get-docker/) and Docker Compose are installed.
2. **Environment Variables**:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```
3. **Start the Stack**:
   ```bash
   docker compose -f docker/docker-compose.yml up --build
   ```
4. **Access**:
   - Frontend UI: `http://localhost:3000`
   - Backend API Docs: `http://localhost:8000/docs`

### Option B: Native Development (Best for Coding)

This approach uses Docker only for the database/cache, while you run the frontend and backend natively on your machine to take advantage of hot-reloading.

1. **Start Infrastructure (DB & Redis)**:
   ```bash
   docker compose -f docker/docker-compose.yml up postgres redis -d
   ```

2. **Start Backend**:
   Ensure you have Python 3.12+ and [Poetry](https://python-poetry.org/) installed.
   ```bash
   cd backend
   cp .env.example .env
   poetry install
   poetry run uvicorn app.main:app --reload --port 8000
   ```

3. **Start Frontend**:
   Ensure you have Node.js 20+ installed.
   ```bash
   cd frontend
   cp .env.example .env.local
   npm install
   npm run dev
   ```

---

## 2. Production Server Deployment

To deploy this platform securely to a live server (e.g., Ubuntu 22.04 on DigitalOcean/AWS), follow these steps:

### Step 1: Provision the Server
1. Create a VPS with at least **2GB RAM** (4GB recommended due to TimescaleDB).
2. SSH into your server: `ssh root@your_server_ip`
3. Install Docker & Git:
   ```bash
   sudo apt update
   sudo apt install -y git docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
   sudo systemctl enable --now docker
   ```

### Step 2: Clone & Configure
1. Clone your repository:
   ```bash
   git clone <your-repo-url> option-analytics
   cd option-analytics
   ```
2. Create production environment variables:
   - For the **Backend** (`backend/.env`):
     ```env
     # backend/.env
     APP_ENV=production
     APP_DEBUG=false
     JWT_SECRET=generate_a_very_long_random_string_here
     JWT_ALGORITHM=HS256
     JWT_EXPIRY_MINUTES=480
     DATABASE_URL=postgresql+asyncpg://postgres:secure_prod_password@postgres:5432/option_analytics
     REDIS_URL=redis://redis:6379/0
     # Important: In prod, CORS should be specific
     CORS_ORIGINS=https://yourdomain.com
     ```
     Note: broker credentials (Fyers/Zerodha) are not environment variables — they are
     supplied per-request via the `/api/v1/auth/login` body.
   - For the **Frontend** (`frontend/.env.local`):
     ```env
     # frontend/.env.local
     # Point this to your backend's public domain or Nginx route
     NEXT_PUBLIC_API_URL="https://api.yourdomain.com/api/v1"
     ```

### Step 3: Modify Docker Compose for Production
By default, the `docker-compose.yml` mounts local volumes for hot-reloading. For production, you should rely on the built container images. 

If you haven't created a specific production docker-compose file, simply run the existing one. It will build the production-ready Next.js artifact and FastAPI container.

```bash
# Build and run in detached mode
docker compose -f docker/docker-compose.yml up --build -d
```

### Step 4: Setup Nginx Reverse Proxy
You do not want to expose ports 3000 and 8000 directly. Instead, use Nginx to route traffic and provide SSL.

1. Create a new Nginx configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/option-analytics
   ```
2. Add the following block (replace `yourdomain.com`):
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;

       # Route to Frontend
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }

       # Route to Backend APIs
       location /api/ {
           proxy_pass http://localhost:8000/api/;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
3. Enable the site and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/option-analytics /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

### Step 5: Enable SSL (HTTPS)
WebSockets and modern browser features require HTTPS.
```bash
sudo certbot --nginx -d yourdomain.com
```
Follow the prompts. Certbot will automatically modify your Nginx config to use SSL and redirect HTTP to HTTPS.

---

## 3. Maintenance

### Viewing Logs
```bash
# View backend logs
docker compose -f docker/docker-compose.yml logs -f backend

# View frontend logs
docker compose -f docker/docker-compose.yml logs -f frontend
```

### Updating to a New Version
When you push new code to your repository, pull it down to the server and rebuild:
```bash
cd option-analytics
git pull origin main
docker compose -f docker/docker-compose.yml up --build -d
```
Docker will intelligently only rebuild what has changed and seamlessly restart the updated containers with zero-downtime using the compose orchestrator.
