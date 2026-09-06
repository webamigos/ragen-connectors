---
name: connectors-add-service
description: Scaffold a whole new MCP service in this monorepo — port allocation, the dual-listener boot sequence, env validation, Dockerfile build context, and the files that must be updated in lockstep. Use when wrapping a new third-party API as a service. Triggers on "add a service", "new connector", "new integration", "nowy serwis", "nowa integracja".
---

# Adding a service here

Copy `services/clickup/` — it is the simplest of the four (tokens don't expire,
so there's no refresh path to unpick).

## The steps that are easy to get wrong

**Claim both ports, in every place that names them.** A service is two
listeners: Hono on `PORT`, FastMCP on `PORT + 1000`. FastMCP owns its own
listener and cannot be mounted on the Hono app (ADR-01). Next free pair is
**8005 / 9005**.

Update all of these together:

- the port table in `AGENTS.md` and `docs/architecture.md`
- your `index.ts`
- the Dockerfile's `EXPOSE`
- `docker-compose.yml`
- the Railway service config

Miss the MCP port and the service passes its health check while being unusable —
the failure surfaces at the client as "no tools", which looks like a client bug.
See `docs/lessons/fastmcp-owns-its-own-listener.md`.

**Keep the boot order.** `index.ts` must:

1. set `OTEL_SERVICE_NAME` if unset, *then* import `instrument.ts` — OTEL patches
   modules at import time, so anything imported earlier is never instrumented
2. validate the environment (exits on failure — that is intended)
3. register tools, start FastMCP on `PORT + 1000`
4. start Hono on `PORT`

**Set vault env vars before importing anything that uses the client.**
`ragenVaultClient` is a module-level singleton built at import time from
`RAGEN_TOKEN_VAULT_URL` and `RAGEN_TOKEN_VAULT_SERVICE_SECRET`.

**Build context is the monorepo root**, so `COPY packages/core` resolves. Set
Railway's Dockerfile path to `services/<name>/Dockerfile` and leave the root
directory at `/`.

## Wiring it up

`services/*` is already a workspace glob, so the package joins automatically —
run `npm install` from the root to link it. Turbo needs no config change either;
it reads the dependency graph from `package.json`. Depend on core as
`"@ragen-connectors/core": "*"`.

## Decide the credential model first

The default is per-customer OAuth through ragen-token-vault (ADR-02): every tool
takes `customer_id`, no service stores a credential.

rejestrio is the one deliberate exception — one service-wide API key, because
the upstream has no per-user auth at all (ADR-04). If your upstream *can* do
per-customer auth, it must. If it genuinely cannot, read ADR-04 for what that
obliges you to build instead: a budget guard, a cost audit, and a kill switch.

## Don't forget

- `.env.example` documenting every variable, matching the boot-time schema
- `.js` extensions on every local import (ESM-only)
- `AbortSignal.timeout(30_000)` on every outbound fetch
- tests in `__tests__/`, mocking the upstream
- a row in the README's service list

## Verify

```bash
npm install
npm run lint && npm run typecheck && npm test
npx turbo run build --filter=@ragen-connectors/<name>
```

Then actually start it and confirm **both** ports answer — `/health` on `PORT`
and an MCP tool listing on `PORT + 1000`. The first alone proves nothing.
