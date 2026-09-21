# ADR-07: A connector is scaffolded, not copied — and the template is where Ragen's wire contract lives

**Status:** Accepted
**Date:** 2026-09-21

## Context

Adding a service here meant copying `services/clickup/`, renaming it, and
updating six things in lockstep: the port table in `AGENTS.md`, the port table
in `docs/architecture.md`, `index.ts`, the Dockerfile's `EXPOSE`,
`docker-compose.yml` and the platform config. `.claude/skills/connectors-add-service`
existed to list them.

A checklist is the weakest possible enforcement of a rule: nothing fails when a
line is skipped. **Four of the six entries in `docs/lessons.md` are the residue
of someone skipping one** —
[`fastmcp-owns-its-own-listener`](../lessons/fastmcp-owns-its-own-listener.md)
(a service whose MCP port nobody claimed passes its health check and is
unusable),
[`an-env-assignment-above-an-import-runs-after-it`](../lessons/an-env-assignment-above-an-import-runs-after-it.md),
[`services-typecheck-against-cores-dist-not-its-source`](../lessons/services-typecheck-against-cores-dist-not-its-source.md)
and
[`dependson-caret-build-skips-the-packages-own-codegen`](../lessons/dependson-caret-build-skips-the-packages-own-codegen.md).

Two things then changed the shape of the problem.

**Ragen's half became free.** ADR-52 over in `RagenAI` turned the catalogue of
connectable services from a compiled-in enum into rows a platform administrator
edits, so adding a connector to a Ragen installation needs no migration, no
deploy and no release. The two halves stopped costing the same, and the
expensive one was this one.

**A second audience appeared.** ADR-52's own problem statement names a company
that wants to connect its own internal MCP server. They have no reason to clone
this repository, and nowhere to learn what Ragen will send them — today that
means reading `apps/web/src/libs/mcp/client.ts` in another codebase.

## Decision

`packages/create-ragen-connector`, published to npm, generates both shapes from
one set of templates: a `services/<slug>` workspace when run inside a checkout
(detected by the `services/*` + `packages/*` workspace globs), and a standalone
project anywhere else.

Three consequences are the substance of this decision.

**The templates are where Ragen's wire contract is written down.** Ragen's
client departs from the bare MCP specification in three places, none of them
discoverable from the specification:

- `customer_id` arrives as a **tool parameter**, not a header —
  `wrapToolsForConnector` strips it from the schema the model sees and injects
  the connector's value. The `x-customer-id` header exists only on
  `server_side`. A connector that read the header would work in development and
  serve the wrong customer on any other auth shape.
- A tool returns `{success}` and never throws (ADR-03).
- **`authenticate` refuses nothing.** Ragen's *Test connection* opens an MCP
  session against the URL an operator just typed and lists the tool names with
  **no headers at all** — that is the only evidence they get before a customer
  finds out the address was wrong. A connector that demanded a header would
  fail the one check anybody runs. So the session is accepted and credentials
  are enforced per tool call, as an envelope the model can pass on. The trade —
  tool *names* readable to anyone who can reach the port, no data — is stated
  in the generated `auth.ts` and held by a test in every generated connector.

Each is generated as compilable code with a test beside it, which is the
difference between a contract and a paragraph.

**`@ragen-connectors/core` stays unpublished, and the standalone target
vendors.** Core carries `RagenVaultClient`, an HMAC-signed contract with an
internal Ragen service whose surface `AGENTS.md` already says needs a two-sided
rollout to change; publishing it would put that on the disk of every third
party and make each internal refactor a semver decision. The standalone target
vendors `env.ts` and `customer.ts` byte for byte, reimplements `logger.ts`
without the OTEL bridge, and stubs `instrument.ts`.
`vendored-runtime-is-current.test.ts` holds the copies to their sources — the
honest cost being that a vendored copy does not get fixes, which is why it is
three small files and not the package.

**`external_mcp` is refused rather than generated.** FastMCP 3 can serve the
OAuth discovery endpoints Ragen's client looks for, but a generated
authorization server nobody can run without their own provider and client
credentials would be unverified boilerplate — which is the thing this ADR is
replacing. The CLI says so by name instead of listing what it accepts.

## Alternatives considered

- **Keep the checklist and add tests that lint the six files.** Catches a
  missed port table after the fact; does nothing for the second audience, and
  nothing about the wire contract.
- **Two separate templates, one per target.** They would drift, and the drift
  would be invisible until somebody's standalone connector encoded a contract
  that changed a release ago. Instead there are three layers — common, auth
  shape, target — and `templates-differ-only-where-they-must.test.ts` holds the
  target layer down to the manifest, the build config it cannot inherit, and
  the runtime seam.
- **Publish `@ragen-connectors/core` and skip the vendoring.** Rejected above.
- **Have the CLI create the catalogue row over an API.** `apps/admin`'s
  catalogue actions are Server Actions, not an API, and going around the form
  would bypass its validation, its audit entry and its address check. The CLI
  emits `ragen-connector.json` and prints the values; `$schema` is there from
  the first release so a later `--register` has something to send.

## Consequences

- Adding a service is one command, and the port tables cannot fall out of step
  because nobody edits them.
- The generated connector is the reference documentation for connecting
  anything to Ragen, which means **a change to Ragen's client is a change to
  these templates**. The tripwire for that is a `p0` e2e test in `RagenAI`,
  not anything in this repository — the templates can only test their own
  assertion of the contract.
- `services/weather` is a generated service kept in the repository as the
  worked example, and is the scaffolder's own integration test: it is
  regenerated, not hand-edited.
- Two rough edges in Ragen were found by doing this and are recorded in its
  spec rather than fixed here: a self-hosted Ragen cannot connect an MCP server
  on its own host unless both are containerised (the address policy admits
  RFC 1918 and refuses loopback, and the refusal message reads as though the
  checkbox is the fix), and a catalogue URL missing `/mcp` is stored one way
  and dialled another.
