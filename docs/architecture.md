# Architecture

Long-form detail behind the summary in [`AGENTS.md`](../AGENTS.md). Read the
relevant section before changing the shape of a service; the ADRs under
[`adrs/`](adrs/) explain *why* each of these is the way it is.

## The shape of a service

Four services, one shared package:

```text
packages/core/          @ragen-connectors/core — vault client, env validation,
                        OAuth state store, OTEL setup
services/google/        Calendar, Drive, Analytics, Ads, Gmail
services/clickup/       ClickUp workspaces
services/hubspot/       HubSpot CRM (readonly)
services/rejestrio/     Polish company registries (KRS)
```

Every service has the same internal layout:

```text
services/<name>/src/
├── index.ts               # entrypoint: env validation → FastMCP + Hono
├── tools/*-tools.ts       # MCP tool definitions (addTool + Zod schemas)
├── services/*.ts          # API client logic (native fetch + AbortSignal.timeout)
├── auth/oauth.ts          # OAuth2 flow (Hono router)
└── auth/token-store.ts    # per-customer token CRUD via ragen-token-vault
```

rejestrio deviates: no `auth/`, because it has no per-customer credential
([ADR-04](adrs/04-rejestrio-uses-a-service-wide-api-key.md)). It adds `cache/`,
`audit/`, `db/`, `client/` and `schemas/` instead.

## Two listeners per service

Each service binds **two ports**: Hono on `PORT` (OAuth, health, REST) and
FastMCP on `PORT + 1000` (the `/mcp` endpoint). FastMCP owns its own listener
and cannot be mounted on the Hono app, which is the whole reason for the split —
[ADR-01](adrs/01-dual-port-hono-and-fastmcp.md).

| Service   | HTTP | MCP  |
| --------- | ---- | ---- |
| google    | 8001 | 9001 |
| clickup   | 8002 | 9002 |
| hubspot   | 8003 | 9003 |
| rejestrio | 8004 | 9004 |

**Keep this table in sync when adding a service.** A service whose MCP port is
unmapped looks healthy and is unusable — see
[`lessons/fastmcp-owns-its-own-listener.md`](lessons/fastmcp-owns-its-own-listener.md).

## Boot order

`index.ts` does the same four things everywhere, in this order:

1. Set `OTEL_SERVICE_NAME` if unset, then import `instrument.ts`. **OTEL patches
   modules at import time**, so anything imported before it is never
   instrumented.
2. Validate the environment (`validateEnvVars` / `validateEnv` from core). Both
   exit the process on failure — a service refusing to boot on a missing
   variable is intended behaviour, not a bug to work around.
3. Register MCP tools, then start FastMCP on `PORT + 1000`.
4. Start Hono on `PORT`.

`RagenVaultClient` is a **module-level singleton constructed at import time**
from `RAGEN_TOKEN_VAULT_URL` and `RAGEN_TOKEN_VAULT_SERVICE_SECRET`. Those must
be set before the module is first imported.

## Multi-tenancy

Every MCP tool takes `customer_id` as a Zod parameter and resolves credentials
per call via `getAccessToken(customerId)` against ragen-token-vault
([ADR-02](adrs/02-credentials-live-in-ragen-token-vault.md)). No service stores
a credential.

Three rules follow, and none of them are enforced by the compiler:

- **Never cache a token in module scope.** It is per-customer state in a process
  that serves every customer.
- **Never derive the customer from anything but the request.** `getCustomerId()`
  in core reads the `x-customer-id` header; the authenticating proxy in front of
  the service is what makes that trustworthy.
- **Cross-customer access is the bug class this repo cares most about.** It is
  the first item in [`SECURITY.md`](../SECURITY.md)'s scope.

The one exception to vault-backed credentials is rejestrio, which holds a single
service-wide API key and guards *spend* rather than data
([ADR-04](adrs/04-rejestrio-uses-a-service-wide-api-key.md)).

## Tool contract

Tools are registered by a `register*Tools(mcp: FastMCP)` function per module,
calling `mcp.addTool()` with a Zod parameter schema.

**Tools never throw.** They return `JSON.stringify({success: true, ...})` or
`JSON.stringify({success: false, error: "..."})`
([ADR-03](adrs/03-tools-return-envelopes-never-throw.md)). A throw reaches the
model as an opaque protocol error rather than something it can act on.

Log the real error before shaping the envelope — otherwise a bug in the catch
block is indistinguishable from a legitimate upstream failure.

## Outbound HTTP

Native `fetch`, no axios. `AbortSignal.timeout(30_000)` on every request. An
un-timed-out fetch against a hung upstream holds the tool call open until the
client gives up.

## Paid upstreams

rejestrio bills per call in PLN against a shared account key. Every paid call
passes through `BudgetGuard` (`src/audit/budget-guard.ts`), which enforces a
per-org daily ceiling; `REJESTRIO_DISABLE_PAID_CALLS=true` serves cache only.

Because a cache miss costs money, **caching is a correctness concern here, not
an optimization** — including caching the "no data available" answer, which is
an authoritative result worth storing
([ADR-05](adrs/05-tiered-fetching-and-caching-negative-results.md)).

Tests must never hit the live API.

## Build graph

`packages/core` is built before anything that depends on it, and services
compile against its emitted `dist/` rather than its source. Turborepo derives
that ordering from the workspace dependency graph
([ADR-06](adrs/06-turborepo-for-the-build-graph.md)); `build`, `lint` and
`typecheck` all declare `dependsOn: ["^build"]`.

`test` deliberately stays outside Turbo — it is one root-level Vitest run whose
config already covers every workspace.

## Deployment

Railway, Dockerfile builder, **build context is the monorepo root** so
`COPY packages/core` resolves. Each service is a separate Railway service
pointing at its own Dockerfile.

rejestrio additionally needs a Postgres add-on; its container entrypoint runs
`prisma migrate deploy` before starting.

## Related repositories

- [ragen-token-vault](https://github.com/webamigos/ragen-token-vault) — stores
  every credential these services use. The HMAC signing format is a contract
  shared between that repo, this one, and ragen-app.
- [ragen-app](https://github.com/webamigos/ragen) — the platform these services
  serve; switches between our MCP servers and official ones by env var.
