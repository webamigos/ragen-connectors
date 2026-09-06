# AGENTS.md

Guidance for coding agents working in this repository. This is the canonical
file — Claude Code, Codex, Cursor and Copilot all read `AGENTS.md`, and
`CLAUDE.md` is a one-line import of it so both names resolve to the same
content. Edit this file, never the pointer.

> **Instruction budget:** keep this file under **32,768 bytes** — Codex's
> default `project_doc_max_bytes`. Content past that offset never reaches the
> agent, silently. Check with `wc -c AGENTS.md`. When it gets close, move
> long-form detail into `docs/` and leave a pointer here rather than trimming
> the hard rules.

## What this is

A TypeScript monorepo of multi-tenant MCP servers. Each service in `services/`
wraps a third-party API (ClickUp, HubSpot, Google, Rejestr.io) as MCP tools over
HTTP, using FastMCP (npm) + Hono. Deployed on Railway. Part of the larger `ragen`
platform; this is the TypeScript port of `ragen-mcp` (Python).

## Commands

```bash
npm install                  # install all workspaces
npm run build                # turbo: core first, then services, cached
npm run typecheck            # turbo: builds deps + codegen first
npm run lint                 # turbo
npm test                     # root Vitest run — covers every workspace
npm run test:watch
npm run test:coverage

npm run dev:google           # hot-reload one service (tsx watch, .env.local)
npm run dev:clickup
npm run dev:hubspot
npm run dev --workspace @ragen-connectors/rejestrio

npm run build -- --filter=@ragen-connectors/rejestrio   # one workspace + deps
npm run build -- --force                                # ignore the cache
```

From inside a service directory: `npm run dev`, `npm run build`,
`npm run start`, `docker compose up --build`.

rejestrio only: `npm run db:migrate`, `npm run db:migrate:dev`,
`npm run generate:types`, `npm run probe`, `npm run probe:dry`.

**The gate before you claim a change works:**

```bash
npm run lint && npm run typecheck && npm test
```

`typecheck` builds `packages/core` and generates rejestrio's Prisma client
first (ADR-06), so it no longer needs a manual `build` in front of it. Run
`npm run build` too if you touched anything that ships.

## Task Router

Before starting a nontrivial task, match it against this table and read the
linked doc(s) first — and check [`docs/lessons.md`](docs/lessons.md) for the
relevant area so you don't re-discover a known gotcha. Skip this for
single-line or obvious fixes.

| Task | Where to look |
|---|---|
| **Adding to a service** | |
| Adding or changing an MCP tool | [ADR-03](docs/adrs/03-tools-return-envelopes-never-throw.md), "Tool contract" below, skill `connectors-add-tool` |
| Adding a whole new service | [`docs/architecture.md`](docs/architecture.md), [ADR-01](docs/adrs/01-dual-port-hono-and-fastmcp.md), skill `connectors-add-service` |
| Adding an env var | "Key conventions" below — schema *and* `.env.example`, both |
| **Credentials and tenancy** | |
| Anything touching tokens, OAuth, `customer_id` | [ADR-02](docs/adrs/02-credentials-live-in-ragen-token-vault.md), [`SECURITY.md`](SECURITY.md) |
| An OAuth flow or token failure | skill `connectors-oauth-triage` |
| Changing the vault HMAC or `X-Service-Name` | [ADR-02](docs/adrs/02-credentials-live-in-ragen-token-vault.md) — cross-repo contract, needs a two-sided rollout |
| **rejestrio / paid APIs** | |
| Anything that can issue a billed call | [ADR-04](docs/adrs/04-rejestrio-uses-a-service-wide-api-key.md), [ADR-05](docs/adrs/05-tiered-fetching-and-caching-negative-results.md), skill `connectors-paid-api-calls` |
| Cache keys, TTLs, or clearing the cache | [ADR-05](docs/adrs/05-tiered-fetching-and-caching-negative-results.md) — this is a billing change |
| Prisma schema / migrations | rejestrio owns its own DB; `prisma migrate deploy` runs on boot |
| **Build and infra** | |
| Build order, turbo tasks, caching | [ADR-06](docs/adrs/06-turborepo-for-the-build-graph.md) |
| Ports, Dockerfiles, Railway, compose | [ADR-01](docs/adrs/01-dual-port-hono-and-fastmcp.md), [`lessons/fastmcp-owns-its-own-listener.md`](docs/lessons/fastmcp-owns-its-own-listener.md) |
| Renaming anything repo-wide | [`lessons/renaming-a-package-scope-leaves-runtime-identifiers.md`](docs/lessons/renaming-a-package-scope-leaves-runtime-identifiers.md) |
| A dependency upgrade or scope change | [`lessons/npm-leaves-the-old-scope-directory-behind.md`](docs/lessons/npm-leaves-the-old-scope-directory-behind.md) |

Full architecture: [`docs/architecture.md`](docs/architecture.md). Decisions and
their reasoning: [`docs/adrs/`](docs/adrs/). Process and branch model:
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Layout

```text
packages/core/          @ragen-connectors/core — shared by every service
services/{google,clickup,hubspot,rejestrio}/
  src/index.ts          entrypoint: env validation → FastMCP + Hono
  src/tools/            MCP tool definitions (addTool + Zod)
  src/services/         API client logic
  src/auth/             OAuth flow + per-customer token store
docs/adrs/              why things are the way they are
docs/lessons.md         gotchas already paid for — check before nontrivial work
```

rejestrio has no `auth/` (no per-customer credential) and adds `cache/`,
`audit/`, `db/`, `client/`, `schemas/`.

## Ports

Each service binds **two**: Hono on `PORT`, FastMCP on `PORT + 1000`. FastMCP
owns its own listener and cannot be mounted on the Hono app (ADR-01).

| Service   | HTTP | MCP  |
| --------- | ---- | ---- |
| google    | 8001 | 9001 |
| clickup   | 8002 | 9002 |
| hubspot   | 8003 | 9003 |
| rejestrio | 8004 | 9004 |

Keep this table in sync when adding a service, and claim both ports in every
Dockerfile, compose file and Railway config. A service with an unmapped MCP port
passes its health check and is unusable.

## Core surfaces (`packages/core`)

- `RagenVaultClient` / `ragenVaultClient` — HMAC-SHA256 client for
  ragen-token-vault. **Module-level singleton built at import time** from
  `RAGEN_TOKEN_VAULT_URL` and `RAGEN_TOKEN_VAULT_SERVICE_SECRET`; set those
  before importing.
- `validateEnvVars(schema)` — Zod validation, exits the process on failure.
- `validateEnv(list)` — string-list check, exits the process on failure.
- `saveState()` / `popState()` — in-memory OAuth state, 10-minute TTL.
- `getCustomerId(headers)` — reads `x-customer-id`.
- `instrument` (`@ragen-connectors/core/instrument`) — OTEL setup.

## Tool contract

Each tool module exports `register*Tools(mcp: FastMCP)` calling `mcp.addTool()`
with a Zod schema.

**Tools never throw.** Always:

```ts
JSON.stringify({ success: true,  /* payload */ })
JSON.stringify({ success: false, error: "what went wrong, in the caller's terms" })
```

A throw reaches the model as an opaque protocol error it cannot act on
(ADR-03). Log the real error before shaping the envelope, or a bug in your
`catch` becomes indistinguishable from a genuine upstream failure.

**Every tool takes `customer_id`.** On google/clickup/hubspot it resolves the
credential per call via `getAccessToken(customerId)` — never cache a token in
module scope, it is per-customer state in a process shared by every customer.
On **rejestrio there is no per-customer credential** (ADR-04): `customer_id` is
parsed for the org id and used to attribute the call's cost and enforce the
budget ceiling, which makes parsing it correctly a spend control rather than a
convenience.

## Key conventions

- **ESM-only** (`"type": "module"`, Node16 resolution). Local imports need `.js`
  extensions: `import { x } from "./x.js"` even though the file is `x.ts`.
- TypeScript strict, ES2022 target. Node 24 (`.nvmrc`).
- **Native `fetch` only** — no axios. `AbortSignal.timeout(30_000)` on every
  outbound request.
- Environment via Node's `--env-file=.env.local`. No dotenv.
- A new env var goes in the service's boot-time validation **and** its
  `.env.example`. Services exiting on a missing variable is intended.
- Services depend on core as `"@ragen-connectors/core": "*"`.
- Comments: default to none. Write one only where the *why* is non-obvious.

## Testing

Tests live in `__tests__/` next to the code, run under Vitest from the root
(`npm test`). New behaviour needs a test.

- **Mock every external service** — provider APIs, ragen-token-vault, Postgres.
- **Never let a test hit a live API**, and never let one consume paid quota.
- Test the `{success: false}` path, not just the happy one — it is the branch
  that actually ships to the model.
- `npm test` runs one root Vitest config covering `packages/*/src` and
  `services/*/src`. It is deliberately outside Turbo (ADR-06).

## Service notes

- **ClickUp** — tokens don't expire, no refresh logic. The root `/` route
  redirects OAuth callbacks to `/auth/callback` because ClickUp strips paths
  from redirect URIs.
- **Google** — one service for Calendar, Drive, Analytics, Ads, Gmail. OAuth
  with PKCE. Also exposes REST endpoints for ragen-app's file pickers:
  `GET /drive/search`, `/drive/file/:id/content`, `/drive/folder/:id/files`.
- **HubSpot** — access tokens expire in ~30 minutes; the service layer
  auto-refreshes on 401 via `refreshAndGetToken()`. Auth domain configurable
  via `HUBSPOT_AUTH_DOMAIN`.
- **rejestrio** — *not* OAuth. One service-wide `REJESTRIO_API_KEY`, sent
  verbatim in `Authorization` with no `Bearer` prefix. Owns its own Postgres
  (cache + cost audit + budget). Every paid call goes through `BudgetGuard`
  (per-org daily PLN ceiling); `REJESTRIO_DISABLE_PAID_CALLS=true` serves cache
  only. `get_financials` is two-tier — see
  [ADR-05](docs/adrs/05-tiered-fetching-and-caching-negative-results.md).

## Adding a new service

1. Copy `services/clickup/`, rename, update `package.json` name to
   `@ragen-connectors/<name>`.
2. It joins the workspace automatically (`services/*`). Run `npm install` from
   the root to link it.
3. Replace `tools/`, `services/`, `auth/` with provider-specific code.
4. Update `index.ts`: env validation, tool registration, port.
5. **Claim both ports** and add a row to the table above and in
   [`docs/architecture.md`](docs/architecture.md).
6. Add its Dockerfile with the monorepo root as build context.

Turbo picks the new workspace up with no config change — it reads the dependency
graph from `package.json`.

## Deployment

Railway, Dockerfile builder, **build context is the monorepo root** so
`COPY packages/core` resolves. Each service is its own Railway service pointing
at its own Dockerfile. rejestrio also needs a Postgres add-on and runs
`prisma migrate deploy` on boot.

CI (GitHub Actions): lint → typecheck + test with coverage → build, on Node 24.
Release is semantic-release from `main`.

## Runtime identifiers still say `ragen-mcp`

`OTEL_SERVICE_NAME` values, their fallbacks in `instrument.ts` and
`otel-logger.ts`, the `X-Service-Name` header sent to ragen-token-vault, and the
`ragen_mcp` Postgres database name all still carry the old name. **This is
deliberate** — each is a contract with a system outside this repo, and renaming
them splits telemetry history or changes an identity the vault records. Do not
"finish the rename" without a coordinated plan:
[`lessons/renaming-a-package-scope-leaves-runtime-identifiers.md`](docs/lessons/renaming-a-package-scope-leaves-runtime-identifiers.md).

## Post-Task Workflow

After modifying or creating files:

1. **Write tests** for new behaviour, including the failure envelope.
2. **Run the gate** — `npm run lint && npm run typecheck && npm test`.
3. **Check the security-sensitive rules** if you touched tokens, `customer_id`,
   or anything that can issue a paid call.
4. **Log a lesson if you hit one** — if you made a nontrivial correction or found
   a non-obvious gotcha, add or update an entry in
   [`docs/lessons.md`](docs/lessons.md) (that file has its own instructions).
   Only record things that actually happened.
5. **Write an ADR** if you made a decision a future reader would otherwise have
   to reverse-engineer. Add it to [`docs/adrs/`](docs/adrs/) and link it from
   the Task Router above.
