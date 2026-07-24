# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build for Raspberry Pi 5 (ARM64) and x86-64
# Build on the Pi:  docker compose up --build
# Native ARM64 CI:  built on a native arm64 runner (no QEMU emulation).
# ─────────────────────────────────────────────────────────────────────────────

# ── 1. Base ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS base
RUN apk upgrade --no-cache \
 && apk add --no-cache libc6-compat python3 make g++

# ── 2. Production dependencies ────────────────────────────────────────────────
FROM base AS prod-deps
WORKDIR /app
COPY package*.json ./
# prisma schema + config must exist before npm ci, because the postinstall
# script runs `prisma generate`.
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
RUN npm prune --omit=dev

# ── 3. Builder ────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ── 4. Runner ─────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js installs its own SIGTERM/SIGINT handler that races with our
# shutdown logic in instrumentation.ts. Disabling it gives our handler sole
# control of the shutdown sequence.
ENV NEXT_MANUAL_SIG_HANDLE=true

RUN apk upgrade --no-cache \
 && apk add --no-cache libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/server.js ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone/.next     ./.next
COPY --from=builder --chown=nextjs:nodejs /app/.next/static               ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth/session > /dev/null || exit 1

# startup.js may generate AUTH_SECRET/ENCRYPTION_KEY into <data>/secrets.env
# (only the values not already provided via environment); source them so the
# server process sees them.
CMD ["sh", "-c", "set -e; node /app/scripts/startup.js; set -a; [ ! -f /app/data/secrets.env ] || . /app/data/secrets.env; set +a; exec node /app/server.js"]
