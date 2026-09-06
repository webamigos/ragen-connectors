# Lessons

A catalog of non-obvious corrections and gotchas, indexed so an agent (or a
human) can check the relevant area before starting nontrivial work in it,
instead of re-discovering the same bug. Mirrors the mechanism used in
`ragen-app`.

## How to use this catalog

Before starting a nontrivial task, skim the bullets under the area(s) it touches
— not the whole catalog. Each bullet links to a lesson file with four fixed
sections: **Context** (what was happening), **Problem** (what went wrong,
concretely), **Rule** (the durable takeaway), **Applies to** (scope).

## Adding or updating a lesson

After a nontrivial correction or a non-obvious gotcha (see `AGENTS.md`'s
"Post-Task Workflow"):

1. Check whether an existing lesson already covers it — extend that file instead
   of creating a near-duplicate.
2. Otherwise add a new file under `docs/lessons/<kebab-case-slug>.md` with the
   front matter (`title`, `modules`, `areas`, `topics`) and the four-section
   shape shown by any existing lesson.
3. Add one bullet to the relevant `### <area>` section below (create the section
   if it's a new area).

A lesson records something that actually happened. Do not add speculative ones —
a rule nobody has been bitten by belongs in `AGENTS.md` or an ADR, not here.

## Catalog

### architecture

- [Services typecheck against core's `dist/`, so typecheck errors after a core change are usually a stale build, not a real error](lessons/services-typecheck-against-cores-dist-not-its-source.md) — area:architecture,testing; module:core,google,clickup,hubspot,rejestrio; topic:typescript,npm-workspaces,build-order,turborepo,false-error. Largely solved structurally by [ADR-06](adrs/06-turborepo-for-the-build-graph.md), but the resolution model it describes still holds.
- [Renaming a package scope does not rename the service, and a find-and-replace that treats them alike breaks live systems](lessons/renaming-a-package-scope-leaves-runtime-identifiers.md) — area:architecture,deployment; module:core,google,clickup,hubspot,rejestrio; topic:rename,monorepo,otel,observability,service-identity. Why the runtime identifiers still say `ragen-mcp` on purpose.

### deployment

- [An env assignment written above an import runs after it — ESM hoists imports, so every `service.name` default in `index.ts` is dead code](lessons/an-env-assignment-above-an-import-runs-after-it.md) — area:architecture,deployment; module:core,google,clickup,hubspot,rejestrio; topic:esm,module-evaluation,otel,observability,env-vars. rejestrio's telemetry currently reports as `ragen-mcp`.
- [FastMCP starts its own HTTP server, so a service that boots cleanly and answers `/health` can still be unreachable over MCP](lessons/fastmcp-owns-its-own-listener.md) — area:architecture,deployment; module:google,clickup,hubspot,rejestrio; topic:fastmcp,hono,ports,docker,railway,health-checks

### dependencies

- [After renaming a workspace scope, npm leaves the old scope directory in `node_modules` and stale imports keep resolving](lessons/npm-leaves-the-old-scope-directory-behind.md) — area:dependencies,architecture; module:core,google,clickup,hubspot,rejestrio; topic:npm-workspaces,rename,node-modules,false-green
- [Turbo will not resolve a workspace without an exact package-manager version, and the modern field is the riskier way to give it one](lessons/turbo-demands-an-exact-package-manager-version.md) — area:dependencies,ci; module:ci; topic:turborepo,npm,devengines,packagemanager,node-24

### ci

- [Turbo's `dependsOn: ["^build"]` builds your dependencies, not you — so a package's own codegen step never runs for a sibling task](lessons/dependson-caret-build-skips-the-packages-own-codegen.md) — area:ci,architecture; module:rejestrio,ci; topic:turborepo,prisma,codegen,task-graph,typecheck. Found while adopting [ADR-06](adrs/06-turborepo-for-the-build-graph.md); a stale generated directory hid it locally.
- [Turbo will not resolve a workspace without an exact package-manager version, and the modern field is the riskier way to give it one](lessons/turbo-demands-an-exact-package-manager-version.md) — area:dependencies,ci; module:ci; topic:turborepo,npm,devengines,packagemanager,node-24
