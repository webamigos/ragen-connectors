---
title: "Services typecheck against core's dist/, so typecheck errors after a core change are usually a stale build, not a real error"
modules: ['core', 'google', 'clickup', 'hubspot', 'rejestrio']
areas: ['architecture', 'testing']
topics: ['typescript', 'npm-workspaces', 'build-order', 'turborepo', 'false-error']
---

# Services typecheck against core's dist/, so typecheck errors after a core change are usually a stale build, not a real error

**Context**: `packages/core` publishes `main`/`types` pointing at `./dist/index.js` and `./dist/index.d.ts`. Services depend on `@ragen-connectors/core: "*"`, which npm links into `node_modules`. So a service's `tsc` reads core's **emitted declarations**, never its `src/`.

**Problem**: this makes `npm run typecheck` meaningless on its own in two situations, and both look like genuine compile errors. On a fresh checkout there is no `dist/` at all, so every service reports that `@ragen-connectors/core` has no exported members. After a change to core's source, `dist/` holds the *previous* declarations, so a service either fails against an export that now exists, or — worse — passes against a signature that no longer does. The second case is the dangerous one: typecheck is green and the runtime is wrong.

**Rule**: never trust a typecheck result for a service without knowing core's `dist/` is current. Since ADR-06 this is handled structurally — `turbo run typecheck` declares `dependsOn: ["^build"]` and builds core first — so use the root `npm run typecheck` rather than invoking `tsc` inside a service directory, which bypasses the graph entirely. If you see a service unable to find an export that plainly exists in core's source, rebuild before debugging.

**Applies to**: every service, and any future workspace that depends on a sibling's build output rather than its source. Note that Vitest resolves differently — the test suite can pass while typecheck fails, and vice versa.
