# Ragen MCP (TypeScript)

TypeScript monorepo for multi-tenant MCP (Model Context Protocol) servers. Each service exposes a third-party API as MCP tools over HTTP.

## Stack

- **Runtime**: Node.js 22 + TypeScript 5.7
- **MCP Framework**: [FastMCP](https://github.com/punkpeye/fastmcp) (npm)
- **HTTP Framework**: [Hono](https://hono.dev) (OAuth routes, health checks)
- **Token Storage**: [ragen-token-vault](https://github.com/webamigos/ragen-token-vault) (AES-256-GCM encrypted, HMAC-authenticated)
- **Validation**: Zod
- **Deployment**: Docker + Railway
- **CI/CD**: GitHub Actions + semantic-release

## Structure

```text
ragen-mcp-ts/
├── packages/core/             # @ragen-mcp/core — shared library
│   └── src/
│       ├── ragen-vault-client.ts  # HMAC-authenticated vault client
│       ├── state-store.ts         # In-memory OAuth state with TTL
│       ├── env.ts                 # Zod-based env validation
│       └── customer.ts            # Multi-tenancy (x-customer-id header)
├── services/
│   ├── clickup/               # ClickUp MCP server (HTTP 8001, MCP 9001)
│   └── hubspot/               # HubSpot MCP server (HTTP 8002, MCP 9002)
└── .github/workflows/         # CI + Release
```

## Quick Start

```bash
# Install all dependencies
npm install

# Build everything
npm run build

# Copy and fill in env vars for a service
cp services/clickup/.env.example services/clickup/.env.local

# Run a service with hot-reload
npm run dev:clickup
```

### With Docker

```bash
# Create shared network (once)
docker network create ragen-network

# Start a service
cd services/clickup
docker compose up --build
```

## Environment Variables

Each service requires these variables in `.env.local`:

| Variable                     | Required | Description                              |
| ---------------------------- | -------- | ---------------------------------------- |
| `RAGEN_TOKEN_VAULT_URL`            | Yes      | ragen-token-vault service URL            |
| `RAGEN_TOKEN_VAULT_SERVICE_SECRET` | Yes      | HMAC shared secret for vault auth        |
| `RAGEN_TOKEN_VAULT_SERVICE_NAME`   | No       | Service identifier (default per service) |
| `PORT`                       | No       | HTTP server port (default: 8001/8002)    |

**ClickUp-specific:**

| Variable                | Required | Description                 |
| ----------------------- | -------- | --------------------------- |
| `CLICKUP_CLIENT_ID`     | Yes      | ClickUp OAuth client ID     |
| `CLICKUP_CLIENT_SECRET` | Yes      | ClickUp OAuth client secret |
| `OAUTH_REDIRECT_URI`    | Yes      | OAuth callback URL          |

**HubSpot-specific:**

| Variable                | Required | Description                              |
| ----------------------- | -------- | ---------------------------------------- |
| `HUBSPOT_CLIENT_ID`     | Yes      | HubSpot OAuth client ID                  |
| `HUBSPOT_CLIENT_SECRET` | Yes      | HubSpot OAuth client secret              |
| `OAUTH_REDIRECT_URI`    | Yes      | OAuth callback URL                       |
| `HUBSPOT_AUTH_DOMAIN`   | No       | Auth domain (default: `app.hubspot.com`) |

## Adding a New Service

1. Copy an existing service directory (e.g., `services/clickup/`)
2. Replace `tools/`, `services/`, and `auth/` with your provider-specific code
3. Update `index.ts` to register your tools
4. Update `package.json` with service name and any extra dependencies

The shared `@ragen-mcp/core` package gives you: ragen-token-vault client, OAuth state management, env validation, and customer ID extraction — out of the box.

## Switching Between Our MCP and Official Servers

In `ragen-app`, configure which MCP server to use per provider:

```bash
# Use our self-hosted servers (default)
CLICKUP_MCP_URL=http://localhost:9001/mcp
HUBSPOT_MCP_URL=http://localhost:9002/mcp

# Use official MCP servers (when accepted)
CLICKUP_MCP_URL=https://mcp.clickup.com
HUBSPOT_MCP_URL=https://mcp.hubspot.com
```

## Railway Deployment

Each service is deployed as a separate Railway service from this monorepo:

1. Create a new Railway service pointing to this repo
2. Set **Root Directory** to `/` (monorepo root)
3. Set **Dockerfile Path** to the service's Dockerfile (e.g., `services/clickup/Dockerfile`)
4. Add environment variables

Build context must be the monorepo root so `COPY packages/core` works in the Dockerfile.

## Token Vault (ragen-token-vault)

OAuth tokens are stored in [ragen-token-vault](https://github.com/webamigos/ragen-token-vault) — a centralized token vault with AES-256-GCM encryption. MCP services are stateless regarding secrets. OAuth pending states are kept in-memory with a 10-minute TTL — no database needed.
