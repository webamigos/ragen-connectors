FROM node:20-slim

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json* tsconfig.base.json ./

# Copy shared core package
COPY packages/core/ ./packages/core/

# Copy service
COPY services/clickup/ ./services/clickup/

# Install dependencies
RUN npm install --workspace=services/clickup --workspace=packages/core

# Build core, then service
RUN npm -w packages/core run build && npm -w services/clickup run build

WORKDIR /app/services/clickup

CMD ["node", "dist/index.js"]
