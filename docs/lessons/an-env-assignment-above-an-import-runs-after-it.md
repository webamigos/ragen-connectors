---
title: 'An env assignment written above an import runs after it — ESM hoists imports, so every service.name default in index.ts is dead code'
modules: ['core', 'google', 'clickup', 'hubspot', 'rejestrio']
areas: ['architecture', 'deployment']
topics: ['esm', 'module-evaluation', 'otel', 'observability', 'env-vars']
---

# An env assignment written above an import runs after it — ESM hoists imports, so every service.name default in index.ts is dead code

**Context**: every service's `index.ts` opens with the same pair of lines, in this order, with a comment explaining the order:

```ts
process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-rejestrio";

// OTEL import must come first — sets up instrumentation before any
// other module loads its instrumented SDKs.
import { shutdownOtel } from "@ragen-connectors/core/instrument";
```

`packages/core/src/instrument.ts` reads `process.env.OTEL_SERVICE_NAME ?? "ragen-mcp"` at module top level, into the OTEL resource. Reading top to bottom, the assignment seeds the name and the import consumes it.

**Problem**: that is not how ESM evaluates. `import` declarations are hoisted — every imported module is fully evaluated **before the first statement of the importing module's body runs**. So `instrument.ts` reads `OTEL_SERVICE_NAME` while it is still unset, and the `??=` assigns afterwards, to nobody. Confirmed with a two-file reduction: the dependency logs `<unset at import time>` and the parent then logs its own value, set too late. The consequence is silent and only visible in a telemetry backend: any service whose environment does not already carry `OTEL_SERVICE_NAME` reports as the fallback `ragen-mcp`. google, clickup and hubspot happen to be fine because their `.env.example` sets the variable and Node's `--env-file` is applied before any module evaluates — rejestrio's does not, so its traces, metrics and logs land under `ragen-mcp` rather than `ragen-mcp-rejestrio`. Nothing warns; the code looks correct and the comment above it argues for the wrong model.

**Rule**: in ESM you cannot prepare state for a static import from the importing module's body — the only things that run earlier are the imports themselves, in source order. Anything a module reads at *its* top level must be in the environment before the process starts: put it in `.env.example` and the deployment env, not in a `process.env.X ??=` line. If a value genuinely must be computed at startup, the import has to become dynamic (`await import(...)` after the assignment) or move into a separate entrypoint that sets the variable and then imports the real one. The general shape to distrust: any statement above an import that the import is supposed to observe.

**Applies to**: every service `index.ts`, and `packages/core/src/instrument.ts`. The `??=` lines are currently ineffective in all four services. Removing them is a behaviour change for telemetry — it would move rejestrio's data from `ragen-mcp` to a new series — so it belongs with the other deliberately-deferred runtime identifiers described in [`renaming-a-package-scope-leaves-runtime-identifiers.md`](renaming-a-package-scope-leaves-runtime-identifiers.md).
