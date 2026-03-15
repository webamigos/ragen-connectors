FROM node:20-slim

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json* ./

# Copy shared core package
COPY packages/core/ ./packages/core/

# Copy service
COPY services/google/ ./services/google/

# Install dependencies
RUN npm install --workspace=services/google --workspace=packages/core

# Build core, then service
RUN npm -w packages/core run build && npm -w services/google run build

WORKDIR /app/services/google

CMD ["node", "dist/index.js"]
