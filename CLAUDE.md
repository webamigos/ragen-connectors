# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript monorepo for multi-tenant MCP (Model Context Protocol) servers. Each service in `services/` wraps a third-party API (ClickUp, HubSpot) as MCP tools over HTTP using FastMCP (npm) + Hono. Deployed on Railway. Part of the larger `ragen` platform. This is the TypeScript port of `ragen-mcp` (Python).

## Commands

From the monorepo root:

```bash
npm install                     # Install all workspace dependencies
npm run build                   # Build all packages
npm run dev:clickup             # Run ClickUp service with hot-reload
npm run dev:hubspot             # Run HubSpot service with hot-reload
npm run typecheck               # Typecheck all packages
npm run lint                    # Lint all packages
```

From within a service directory:

```bash
npm run dev                     # tsx watch --env-file=.env.local
npm run build                   # tsc
npm run start                   # node --env-file=.env.local dist/index.js
docker compose up --build       # Docker (requires ragen-network)
```

There is no test suite yet.

## Architecture

### Shared core (`packages/core/` → `@ragen-mcp/core`)

Provides `RagenVaultClient` (HMAC-authenticated HTTP client for ragen-vault), `validateEnvVars()` (Zod-based, matches ragen-vault/worker pattern), `validateEnv()` (simple string list), `saveState()`/`popState()` (in-memory OAuth state with TTL), and `getCustomerId()` (extracts `x-customer-id` header).

### Service structure (each service follows the same pattern)

```
services/<name>/
├── src/
│   ├── index.ts               # Entrypoint: env validation → FastMCP + Hono setup
│   ├── tools/*-tools.ts       # MCP tool definitions (FastMCP addTool + Zod schemas)
│   ├── services/*.ts          # API client logic (native fetch with AbortSignal.timeout)
│   ├── auth/oauth.ts          # OAuth2 flow endpoints (Hono router)
│   ├── auth/token-store.ts    # Per-customer token CRUD via ragen-vault
│   └── auth/state-store.ts    # In-memory OAuth state (imported from @ragen-mcp/core)
├── .env.example               # Required environment variables
├── docker-compose.yml         # Local dev with ragen-network
├── Dockerfile                 # Build context is monorepo root
├── package.json
└── tsconfig.json
```

### Multi-tenancy pattern

Every MCP tool receives `customer_id` as a parameter. OAuth tokens are stored per-customer in ragen-vault (centralized token vault). `getAccessToken(customerId)` retrieves the correct token.

### Tool registration pattern

Each tool module exports a `register*Tools(mcp: FastMCP)` function that calls `mcp.addTool()` with Zod parameter schemas. Tools always return JSON strings with `{success: true, ...}` or `{success: false, error: "..."}`.

### Key conventions

- **ESM-only** (`"type": "module"`) — all local imports use `.js` extensions.
- TypeScript strict mode, ES2022 target, Node16 module resolution.
- Native `fetch` for HTTP calls — no axios/httpx dependency.
- `AbortSignal.timeout(30_000)` on all outbound HTTP requests.
- Environment loaded via `--env-file=.env.local` (Node native flag, matches ragen-vault/worker pattern). No dotenv dependency.
- `validateEnvVars()` uses Zod (matches ragen-vault/worker). `validateEnv()` is a simpler string-list alternative.
- OAuth pending states stored in-memory with 10-minute TTL — no database needed.
- npm workspaces for monorepo management.

### Deployment

- Railway with Dockerfile builder. Build context must be monorepo root so `COPY packages/core` works.
- Ports: ClickUp HTTP on 8001 (MCP on 9001), HubSpot HTTP on 8002 (MCP on 9002).
- GitHub Actions: CI (lint + typecheck + build), Release (semantic-release).

### Service-specific notes

- **ClickUp**: OAuth tokens don't expire, no refresh logic needed. Root `/` route redirects OAuth callbacks to `/auth/callback` because ClickUp strips paths from redirect URIs.
- **HubSpot**: Access tokens expire after ~30 minutes. Service layer auto-refreshes on 401 via `refreshAndGetToken()`. Auth domain configurable via `HUBSPOT_AUTH_DOMAIN` env var (defaults to `app.hubspot.com`).

### Switching between our MCP and official MCP servers

In `ragen-app`, switch between self-hosted and official MCP servers via env vars:

```bash
CLICKUP_MCP_URL=http://localhost:9001/mcp    # our server
HUBSPOT_MCP_URL=http://localhost:9002/mcp    # our server
# or official MCPs when accepted
CLICKUP_MCP_URL=https://mcp.clickup.com
HUBSPOT_MCP_URL=https://mcp.hubspot.com
```
