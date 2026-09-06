---
title: "Turbo's dependsOn ^build builds your dependencies, not you — so a package's own codegen step never runs for a sibling task"
modules: ['rejestrio', 'ci']
areas: ['ci', 'architecture']
topics: ['turborepo', 'prisma', 'codegen', 'task-graph', 'typecheck']
---

# Turbo's dependsOn ^build builds your dependencies, not you — so a package's own codegen step never runs for a sibling task

**Context**: adopting Turborepo (ADR-06), the point of which was to make `npm run typecheck` safe from cold by declaring `typecheck: { dependsOn: ["^build"] }` — so that `packages/core` is built before any service typechecks against its `dist/`. That worked, and the CI jobs for lint and typecheck had their explicit `npm run build` step removed as now-redundant.

**Problem**: `npm run typecheck` then failed from a clean checkout with 8 × `TS2307: Cannot find module '../generated/prisma/client.js'`. The caret in `^build` means *the `build` task of this package's dependencies*, not this package's own `build`. rejestrio generates its Prisma client as the first half of its own build script (`prisma generate && tsc -p tsconfig.build.json`), so `^build` built `core` and stopped — rejestrio's `tsc --noEmit` ran against a `src/generated/` that did not exist. It was invisible locally because a previous build had left the generated client on disk, and then turbo cached the successful typecheck; it only reproduced after deleting `src/generated`, `dist/` and `.turbo` together. Had it shipped, CI would have failed on the first clean run with an error pointing at Prisma rather than at the task graph.

**Rule**: `^build` covers dependencies only. Any artifact a package generates *for itself* — a Prisma client, a GraphQL or protobuf codegen step, generated route types — must be its own task with its own `outputs`, and every sibling task that consumes it must depend on it by name: `typecheck: { dependsOn: ["^build", "generate:types"] }`. Turbo skips the dependency for packages that don't define that script, so one root-level rule covers a monorepo where only some packages generate code. When verifying a task-graph change, delete the generated directory as well as `dist/` and `.turbo` — a stale artifact on disk makes a broken graph look correct, and a cache hit then preserves the illusion.

**Applies to**: `turbo.json` at the repo root, and `services/rejestrio` specifically. Re-check whenever a package gains a code-generation step: the graph will not tell you it is missing, only a genuinely clean checkout will.
