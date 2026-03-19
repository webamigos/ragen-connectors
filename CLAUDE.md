# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript monorepo for multi-tenant MCP (Model Context Protocol) servers. Each service in `services/` wraps a third-party API (ClickUp, HubSpot, Google) as MCP tools over HTTP using FastMCP (npm) + Hono. Deployed on Railway. Part of the larger `ragen` platform. This is the TypeScript port of `ragen-mcp` (Python).

## Commands

From the monorepo root:

```bash
npm install                     # Install all workspace dependencies
npm run build                   # Build all packages (core first, then services)
npm run dev:clickup             # Run ClickUp service with hot-reload
npm run dev:google              # Run Google service with hot-reload
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

Build order matters: `@ragen-mcp/core` must build before any service. `npm run build` at root handles this because npm processes workspaces in dependency order.

There is no test suite yet.

## Architecture

### Dual-port design

Each service runs two servers:
- **Hono HTTP** (port 8001/8002/8003) — OAuth flow endpoints (`/auth/*`), health check (`/health`), REST endpoints, root redirect
- **FastMCP HTTP stream** (port 9001/9002/9003) — MCP protocol endpoint (`/mcp`)

FastMCP starts its own HTTP server and cannot be mounted on an existing one, so the MCP port is `PORT + 1000`.

### Shared core (`packages/core/` → `@ragen-mcp/core`)

- `RagenVaultClient` — HMAC-SHA256 authenticated HTTP client for ragen-token-vault. Module-level singleton `ragenVaultClient` is created at import time from `RAGEN_TOKEN_VAULT_URL` and `RAGEN_TOKEN_VAULT_SERVICE_SECRET` env vars. **Set env vars before importing.**
- `validateEnvVars(schema)` — Zod-based validation, exits process on failure (matches ragen-token-vault/worker pattern).
- `validateEnv(list)` — Simple string-list check, exits process on failure.
- `saveState()`/`popState()` — In-memory OAuth state store with 10-minute TTL. Thread-safe cleanup on access.
- `getCustomerId(headers)` — Extracts `x-customer-id` from request headers.

### Service structure

```text
services/<name>/src/
├── index.ts               # Entrypoint: env validation → FastMCP + Hono setup
├── tools/*-tools.ts       # MCP tool definitions (addTool + Zod schemas)
├── services/*.ts          # API client logic (native fetch + AbortSignal.timeout)
├── auth/oauth.ts          # OAuth2 flow (Hono router: /auth/<provider>, /auth/callback, /auth/status)
└── auth/token-store.ts    # Per-customer token CRUD via ragen-token-vault
```

### Multi-tenancy

Every MCP tool receives `customer_id` as a Zod parameter. Tokens are stored per-customer in ragen-token-vault. `getAccessToken(customerId)` retrieves the correct token from the vault.

### Tool registration pattern

Each tool module exports a `register*Tools(mcp: FastMCP)` function that calls `mcp.addTool()` with Zod parameter schemas. Tools always return `JSON.stringify({success: true, ...})` or `JSON.stringify({success: false, error: "..."})` — never throw.

### Key conventions

- **ESM-only** (`"type": "module"`) — all local imports must use `.js` extensions.
- TypeScript strict mode, ES2022 target, Node16 module resolution.
- Native `fetch` for all HTTP calls — no axios dependency.
- `AbortSignal.timeout(30_000)` on all outbound HTTP requests.
- Environment loaded via `--env-file=.env.local` (Node native flag, matches ragen-token-vault/worker). No dotenv dependency.
- npm workspaces for monorepo. Services reference core as `"@ragen-mcp/core": "*"`.

### Service-specific notes

- **ClickUp**: OAuth tokens don't expire — no refresh logic. Root `/` route redirects OAuth callbacks to `/auth/callback` because ClickUp strips paths from redirect URIs.
- **Google**: Single service covering Calendar, Drive, Analytics, Ads, and Gmail tools. OAuth via ragen-token-vault with PKCE. Drive tools include `search_drive_files`, `read_drive_file`, `get_drive_file_info`, `list_drive_folder_files`. Also exposes REST endpoints for ragen-app UI file pickers: `GET /drive/search`, `GET /drive/file/:id/content`, `GET /drive/folder/:id/files`.
- **HubSpot**: Access tokens expire after ~30 minutes. Service layer auto-refreshes on 401 via `refreshAndGetToken()`. Auth domain configurable via `HUBSPOT_AUTH_DOMAIN` (defaults to `app.hubspot.com`).

### Deployment

- Railway with Dockerfile builder. Build context is monorepo root so `COPY packages/core` works.
- Ports: Google HTTP 8001 / MCP 9001, ClickUp HTTP 8002 / MCP 9002, HubSpot HTTP 8003 / MCP 9003.
- GitHub Actions: CI (lint + typecheck + build on Node 22), Release (semantic-release on main).

### Adding a new service

1. Copy `services/clickup/`, rename, update `package.json` name.
2. Add to root `package.json` workspaces (automatic if under `services/`).
3. Replace `tools/`, `services/`, `auth/` with provider-specific code.
4. Update `index.ts`: env validation, tool registration, port.
5. Run `npm install` from root to link the new workspace.

### Switching between our MCP and official MCP servers

In `ragen-app`, switch via env vars:

```bash
MCP_GOOGLE_SERVER_URL=http://localhost:9001/mcp   # our server
CLICKUP_MCP_URL=http://localhost:9002/mcp         # our server
HUBSPOT_MCP_URL=http://localhost:9003/mcp         # our server
# or official MCPs when accepted
CLICKUP_MCP_URL=https://mcp.clickup.com
HUBSPOT_MCP_URL=https://mcp.hubspot.com
```
