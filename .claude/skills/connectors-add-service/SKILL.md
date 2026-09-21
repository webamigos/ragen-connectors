---
name: connectors-add-service
description: Add a whole new MCP service to this monorepo, or a standalone one outside it — scaffolding with create-ragen-connector, then the decisions a template cannot make for you. Use when wrapping a new third-party API as a service. Triggers on "add a service", "new connector", "new integration", "nowy serwis", "nowa integracja".
---

# Adding a service here

**Do not copy `services/clickup/` by hand.** Run the scaffolder:

```bash
npx create-ragen-connector "Notion" --slug=notion --auth=server_side
```

Run it from the repository root and it writes `services/<slug>/`, claims the
next free port pair, and updates the port table in **both** `AGENTS.md` and
`docs/architecture.md`. Run it anywhere else and it writes a standalone project
instead. `packages/create-ragen-connector/README.md` has the flags.

It also prints the values for the Ragen catalogue row and leaves them in
`ragen-connector.json`. Adding a connector to Ragen needs no deploy of Ragen
and no migration: a platform administrator types that row at `/mcp-catalogue`.

This skill used to be a six-item checklist of files to keep in lockstep. Four
of the six lessons in `docs/lessons.md` are the residue of someone skipping a
line of it, which is why the checklist is now a program. What is left here is
what a template cannot decide.

## Decide the credential model first — this is the real work

The default is per-customer OAuth through ragen-token-vault (ADR-02): every
tool takes `customer_id`, no service stores a credential.

`rejestrio` is the one deliberate exception — one service-wide API key, because
the upstream has no per-user auth at all (ADR-04). **If your upstream *can* do
per-customer auth, it must.** If it genuinely cannot, ADR-04 says what that
obliges you to build instead: a budget guard, a cost audit keyed on the org,
and a kill switch. A service-wide key with none of those means the first
customer to loop a tool call spends the budget for all of them.

The scaffolder templates `server_side` and `api_key_bearer`. **It does not
template `external_mcp`** — that needs an authorization server and client
credentials, and a generated one nobody can run would be exactly the kind of
unverified boilerplate this skill stopped handing out. Wire FastMCP's `oauth`
option by hand, and read ADR-02 before you store anything.

## What the generated service already gets right

Do not "fix" these; each is a lesson someone paid for.

- **Two listeners** — Hono on `PORT`, FastMCP on `PORT + 1000` (ADR-01), both
  `EXPOSE`d and both published in the compose file. A service with an unmapped
  MCP port passes its health check and is unusable, and the client reports it
  as "no tools", which looks like a client bug.
- **`OTEL_SERVICE_NAME` in `.env.example`, never a `??=` in `index.ts`.** ESM
  evaluates imports first, so that assignment runs *after* `instrument.ts` has
  already read the variable.
- **The Dockerfile's build context is the monorepo root**, so `COPY
  packages/core` resolves. Point the platform's Dockerfile path at
  `services/<name>/Dockerfile` and leave the root directory at `/`.
- **`authenticate` refuses nothing.** Ragen's Test connection opens a session
  with no headers at all; a connector that demanded one would look broken at
  the only moment an operator checks it. Credentials are enforced per tool
  call, as an envelope.
- **`.js` extensions on every local import**, because ESM.

## Then

```bash
npm install                      # links the new workspace
npm run lint && npm run typecheck && npm test
npm run build -- --filter=@ragen-connectors/<name>
```

Start it and confirm **both** ports answer — `/health` on `PORT` and a tool
listing on `PORT + 1000`. The first alone has never been evidence.

Replace the example tool with real ones (skill `connectors-add-tool`), keeping
the envelope contract in ADR-03, and add a row to the README's service list.
