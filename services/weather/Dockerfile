FROM node:24-slim

WORKDIR /app

# The build context is the MONOREPO ROOT, not this directory — `COPY
# packages/core` has to resolve. Point your platform's Dockerfile path at
# services/weather/Dockerfile and leave the root directory at /.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/core/ ./packages/core/
COPY services/weather/ ./services/weather/

RUN npm install --workspace=services/weather --workspace=packages/core
RUN npm -w packages/core run build && npm -w services/weather run build

WORKDIR /app/services/weather

# Both listeners. Publishing only 8005 leaves a container whose health
# check passes and whose tools never load.
EXPOSE 8005 9005

ENV NODE_OPTIONS="--dns-result-order=ipv6first"

CMD ["node", "dist/index.js"]
