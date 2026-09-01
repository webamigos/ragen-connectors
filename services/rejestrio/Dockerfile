# Multi-stage build combining the ragen-mcp monorepo workspace layout
# (see services/google/Dockerfile) with Prisma generation (see
# ragen-token-vault/Dockerfile).
#
# Why a single `FROM node:24-slim` and not the split base/deps/prod-deps
# pattern? ragen-mcp services share a workspace install at the root,
# so splitting stages mainly hurts here — each stage would have to
# re-run `npm install --workspace=...` against the same lockfile. Keep
# the straight-through build for consistency with sibling services;
# revisit if image size becomes an issue.

FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace root files
COPY package.json package-lock.json* tsconfig.base.json ./

# Shared core package
COPY packages/core/ ./packages/core/

# This service (incl. prisma/ and prisma.config.ts)
COPY services/rejestrio/ ./services/rejestrio/

# Install dependencies for just this service + core — faster than a
# full-monorepo install, still deterministic via the shared lockfile.
RUN npm install \
    --workspace=services/rejestrio \
    --workspace=packages/core

# Build core first, then generate Prisma client + compile rejestrio.
# The `build` script in services/rejestrio/package.json runs
# `prisma generate` before tsc.
RUN npm -w packages/core run build \
    && npm -w services/rejestrio run build

# Non-root runtime user.
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app
RUN chown -R app:app /app

WORKDIR /app/services/rejestrio

USER app

# Prefer IPv6 DNS for Railway internal networking (neutral on IPv4-only).
ENV NODE_OPTIONS="--dns-result-order=ipv6first"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl --fail http://localhost:${PORT:-8004}/health || exit 1

# Entrypoint runs migrations then starts the server. Migrations are
# idempotent — safe to run on every boot.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
