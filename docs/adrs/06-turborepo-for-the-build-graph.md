# ADR-06: Turborepo owns the build graph

**Status:** Accepted
**Date:** 2026-09-06

## Context

`packages/core` is a dependency of all four services, and services compile
against its emitted `dist/` rather than its source. That makes the build
order load-bearing: core must build first, always.

Until now the root scripts were `npm -ws run build` / `lint` / `typecheck`. npm
walks workspaces in dependency order, so the ordering was correct — but nothing
else about it was:

- **Every build rebuilt all five workspaces**, whether or not anything changed.
  A no-op build cost 7.6s.
- **`npm run typecheck` did not build first.** Services typecheck against core's
  `dist/`, so on a fresh checkout, or after any change to core, typecheck
  reported errors that were entirely artifacts of a stale build. The workaround
  was a documented instruction to "always run build before typecheck", which is
  the kind of rule that gets skipped.
- ragen-app already uses Turborepo, so agents and contributors moving between
  the two repos met two different task models.

## Decision

Adopt Turborepo for `build`, `lint` and `typecheck`. `turbo.json` declares each
with `dependsOn: ["^build"]`, so Turbo derives the ordering from the workspaces'
own `package.json` dependencies and builds core before anything that needs it —
including before a lint or a typecheck.

`typecheck` additionally depends on `generate:types` by name. `^build` covers a
package's *dependencies*, not the package itself, so rejestrio's `prisma
generate` — the first half of its own build script — would otherwise never run
before its `tsc --noEmit`. Turbo skips that dependency for packages with no such
script, so one root rule covers the whole repo. See
[`docs/lessons/dependson-caret-build-skips-the-packages-own-codegen.md`](../lessons/dependson-caret-build-skips-the-packages-own-codegen.md).

`test` stays outside Turbo. It is a single root-level Vitest run whose config
already covers `packages/*/src` and `services/*/src`; there is nothing to
parallelize per workspace and nothing to gain.

Measured on this repo:

| Scenario | `npm -ws run build` | Turborepo |
| --- | --- | --- |
| Cold build | 11.8s | 4.6s |
| Nothing changed | 7.6s | 0.02s |
| One service changed | 7.6s | 1.5s |
| `packages/core` changed | 7.6s | 4.9s |

## Consequences

**The stale-`dist/` foot-gun is gone structurally.** `npm run typecheck` now
builds core and generates rejestrio's Prisma client first, verified from a
clean checkout with `node_modules`, `dist/`, `src/generated/` and `.turbo` all
removed. The instruction to build beforehand is no longer
load-bearing, though running the full gate is still the honest check.

**Turbo hashes content, not mtimes.** `touch` on a source file is correctly a
cache hit. A genuine one-character change to `packages/core` correctly
invalidates all five tasks.

**There is no remote cache.** The cache is local (`.turbo/`, gitignored), so CI
gets no cross-job reuse — each of the four CI jobs still builds cold. The win in
CI is parallelism only (11.8s → 4.6s); the caching win is local. Adding a remote
cache is what would make CI benefit, and is not done here.

**`outputs` must name build products only.** Currently `dist/**` and
`src/generated/**` (rejestrio's Prisma client). If a build ever starts writing
transient state into a declared output directory, Turbo will snapshot it into
the cache on every build — ragen-app filled a disk this way, see
[`docs/lessons/turbo-cached-the-turbopack-dev-cache.md`](https://github.com/webamigos/ragen/blob/main/docs/lessons/turbo-cached-the-turbopack-dev-cache.md)
in that repo.

**Turbo requires an exact package-manager version.** `package.json` now carries
`"packageManager": "npm@11.19.0"` — the npm bundled with Node 24.20.0. Turbo
refuses to resolve the workspace without it, and rejects a semver *range*. See
[`docs/lessons/turbo-demands-an-exact-package-manager-version.md`](../lessons/turbo-demands-an-exact-package-manager-version.md)
for why the legacy field is used rather than `devEngines`.
