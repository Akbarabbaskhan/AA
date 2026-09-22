# syntax=docker/dockerfile:1

# Volt runs on a single VPS behind Docker Compose — cheaper than managed hosting at this
# scale and it keeps the school's data in one place, which they will ask about.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/bin
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS deps
# argon2 and Prisma both build native bindings.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
# The schema is needed at build time for the generated client's types.
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Never run the app as root.
RUN groupadd --system --gid 1001 volt && useradd --system --uid 1001 --gid volt volt

COPY --from=builder --chown=volt:volt /app/.next/standalone ./
COPY --from=builder --chown=volt:volt /app/.next/static ./.next/static
COPY --from=builder --chown=volt:volt /app/public ./public
COPY --from=builder --chown=volt:volt /app/themes ./themes
COPY --from=builder --chown=volt:volt /app/messages ./messages
# Migrations and the generated client, so the container can run `prisma migrate deploy`.
COPY --from=builder --chown=volt:volt /app/prisma ./prisma
COPY --from=builder --chown=volt:volt /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=volt:volt /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=volt:volt /app/node_modules/prisma ./node_modules/prisma

USER volt
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
