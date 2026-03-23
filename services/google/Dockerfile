FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json* tsconfig.base.json ./

# Copy shared core package
COPY packages/core/ ./packages/core/

# Copy service
COPY services/google/ ./services/google/

# Install dependencies
RUN npm install --workspace=services/google --workspace=packages/core

# Build core, then service
RUN npm -w packages/core run build && npm -w services/google run build

# Create non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app
RUN chown -R app:app /app

WORKDIR /app/services/google

USER app

# Prefer IPv6 DNS resolution for Railway internal networking (neutral on IPv4-only networks)
ENV NODE_OPTIONS="--dns-result-order=ipv6first"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl --fail http://localhost:${PORT:-8001}/health || exit 1

CMD ["node", "dist/index.js"]
