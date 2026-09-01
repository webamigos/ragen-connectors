FROM node:24-slim

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json* tsconfig.base.json ./

# Copy shared core package
COPY packages/core/ ./packages/core/

# Copy service
COPY services/hubspot/ ./services/hubspot/

# Install dependencies
RUN npm install --workspace=services/hubspot --workspace=packages/core

# Build core, then service
RUN npm -w packages/core run build && npm -w services/hubspot run build

WORKDIR /app/services/hubspot

# Prefer IPv6 DNS resolution for Railway internal networking (neutral on IPv4-only networks)
ENV NODE_OPTIONS="--dns-result-order=ipv6first"

CMD ["node", "dist/index.js"]
