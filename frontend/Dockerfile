# Frontend Dockerfile — Multi-stage Next.js build
# Stage 1: Install dependencies
FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
COPY vendor/ ./vendor/
RUN npm ci --ignore-scripts

# Development image. Source is bind-mounted by docker-compose.dev.yml while
# node_modules stays in a named volume, so Next can hot-reload without a
# rebuild after every edit.
FROM node:24-alpine AS development
WORKDIR /app

COPY package.json package-lock.json* ./
COPY vendor/ ./vendor/
RUN npm ci --ignore-scripts

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# Stage 2: Build
FROM node:24-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN mkdir -p public && npm run build

# Stage 3: Production
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
