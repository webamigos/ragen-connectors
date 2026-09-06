# Contributing to Ragen Connectors

Thanks for wanting to help. This repo holds the multi-tenant MCP servers that
wrap third-party APIs (ClickUp, HubSpot, Google, Rejestr.io) as MCP tools. This
guide covers how we branch, what we expect in a pull request, and the handful of
things about this codebase that reliably trip people up.

## Before you start

- **Bugs and small fixes** — open a PR directly. No need to ask first.
- **New services or anything architectural** — open an issue first so we can
  agree on the approach before you spend time on it.
- **Security vulnerabilities** — do **not** open an issue. See
  [SECURITY.md](SECURITY.md).

## Branch model

- `main` — release-ready. Every commit is deployable.
- `dev` — integration branch. **Base your work here and target it in PRs.**
- Topic branches — one per change, named `feat/…`, `fix/…`, `chore/…`,
  `refactor/…` or `docs/…`.

Releases go `dev → main` as a single PR.

## Getting set up

Node.js 24.x (see `.nvmrc`). From the monorepo root:

```bash
npm install
npm run build              # turbo: core first, then services, cached
npm run dev:google         # or dev:clickup / dev:hubspot
```

For Rejestrio, which is not in the root `dev:*` shortcuts:

```bash
npm run dev --workspace @ragen-connectors/rejestrio
```

Each service reads its config from `.env.local` via Node's native `--env-file`
flag — there is no dotenv dependency. Copy the service's `.env.example` and fill
it in. Services **exit on boot** if a required variable is missing or malformed,
so a startup crash is usually a missing env var, not a code bug.

## Before you open a PR

Run the same gate CI runs:

```bash
npm run lint
npm run typecheck
npm test
```

`lint` and `typecheck` run through Turborepo, which builds `packages/core` first
because both declare `dependsOn: ["^build"]` — so you no longer have to remember
to build by hand ([ADR-06](docs/adrs/06-turborepo-for-the-build-graph.md)). Add
`npm run build` if you changed anything that ships.

Results are cached by content hash, so a repeat run with nothing changed is
effectively instant. `npx turbo run build --force` ignores the cache if you ever
need to prove a build from cold.

## Four things that catch everyone

**1. Local imports need `.js` extensions.** The whole repo is ESM-only
(`"type": "module"`, Node16 resolution). Write `import { foo } from "./foo.js"`
even though the file on disk is `foo.ts`. Omitting the extension typechecks in
some editors and then fails at runtime.

**2. Services compile against core's `dist/`, not its source.** Turborepo now
enforces the ordering for `build`, `lint` and `typecheck`, so the root commands
are safe. What is still true: running `tsc` *inside* a service directory bypasses
the graph entirely and compiles against whatever `dist/` happens to be there. If
a service can't find an export that plainly exists in core's source, rebuild
before you start debugging —
[`docs/lessons/services-typecheck-against-cores-dist-not-its-source.md`](docs/lessons/services-typecheck-against-cores-dist-not-its-source.md).

**3. Every tool is multi-tenant.** Each MCP tool takes `customer_id` as a Zod
parameter and resolves credentials through `getAccessToken(customerId)` against
ragen-token-vault. Never cache a token in module scope, and never let one
customer's request reach another's token — that is the bug class this repo cares
most about.

**4. Rejestr.io calls cost real money.** The rejestrio service bills per upstream
call in PLN. `BudgetGuard` enforces a per-org daily ceiling and every paid call
goes through it — don't add a code path that bypasses it. When developing, set
`REJESTRIO_DISABLE_PAID_CALLS=true` to serve from cache only. Tests must never
hit the live API.

## Adding a new service

The steps are in [CLAUDE.md](CLAUDE.md#adding-a-new-service). Two things that
aren't obvious:

- **Claim both ports.** Each service runs a Hono HTTP server *and* a FastMCP
  stream server, and FastMCP starts its own listener rather than mounting on the
  existing one — so the MCP port is always `PORT + 1000`. Add your service to
  the port table in [CLAUDE.md](CLAUDE.md#dual-port-design) so the next person
  doesn't collide with you.
- **Run `npm install` from the root** after creating the directory, so npm links
  the new workspace.

## Tests

New code needs tests. They live in `__tests__/` directories next to the source
they test, and run under Vitest from the repo root.

Mock every external service — the provider APIs, ragen-token-vault, Postgres.
Never hit a real backend from a test, and never let a test consume paid API
quota.

## Tool behaviour

MCP tools **never throw**. They return `JSON.stringify({ success: true, ... })`
or `JSON.stringify({ success: false, error: "..." })`. An uncaught throw
surfaces to the model as a protocol error rather than something it can reason
about, so catch and shape it.

Use native `fetch` for outbound HTTP — no axios — and put
`AbortSignal.timeout(30_000)` on every request.

## Commits and PRs

We use [Conventional Commits](https://www.conventionalcommits.org/). Releases
are cut by semantic-release from `main`, so the commit type determines the
version bump.

```
feat(google): add Drive folder listing tool
fix(hubspot): refresh the token on 401 instead of failing the call
docs: correct the rejestrio port in the README
```

In the PR description, say what changed and why, and what you ran to convince
yourself it works. Link the issue with `Fixes #123`.

## Where to look things up

[`AGENTS.md`](AGENTS.md) is the canonical orientation file — architecture,
conventions, and a **Task Router** table mapping a kind of task to the doc that
explains it. `CLAUDE.md` is a one-line import of it, so edit `AGENTS.md`.

Before nontrivial work, check [`docs/lessons.md`](docs/lessons.md) for the area
you're touching: it catalogs gotchas someone has already paid for. Architecture
decisions and their reasoning live in [`docs/adrs/`](docs/adrs/) — read the
relevant one before changing something it covers, and add one if you make a
decision a future reader would otherwise have to reverse-engineer.

If you hit a non-obvious gotcha while working, add a lesson. That file has
instructions; the only hard rule is that a lesson records something that
actually happened.

## Licensing

Contributions are accepted under the [Apache License 2.0](LICENSE), the same
license that covers the project. By opening a pull request you confirm you have
the right to contribute the code and agree to license it under those terms.
