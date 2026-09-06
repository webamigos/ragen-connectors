---
title: 'Renaming a package scope does not rename the service, and a find-and-replace that treats them alike breaks live systems'
modules: ['core', 'google', 'clickup', 'hubspot', 'rejestrio']
areas: ['architecture', 'deployment']
topics: ['rename', 'monorepo', 'otel', 'observability', 'service-identity']
---

# Renaming a package scope does not rename the service, and a find-and-replace that treats them alike breaks live systems

**Context**: the GitHub repository was renamed `ragen-mcp` → `ragen-connectors`, and the workspace and package names were brought in line with it: root `ragen-mcp-ts` → `ragen-connectors`, scope `@ragen-mcp/*` → `@ragen-connectors/*`. A repo-wide grep for the old name returned 43 files.

**Problem**: those 43 hits were not one kind of thing. Most were package names and imports — pure source, safe to rewrite. But the same string also appeared as: `OTEL_SERVICE_NAME` values (`ragen-mcp-google`, `-clickup`, `-hubspot`, `-rejestrio`) and their fallbacks in `instrument.ts` and `otel-logger.ts`; the `X-Service-Name` header that `ragen-vault-client.ts` sends to ragen-token-vault to identify the caller; and `ragen_mcp`, an actual Postgres database name in rejestrio's `.env.example`. A single `sed` across all 43 files would have compiled, passed every test, and then: split telemetry into disconnected before/after series in whatever backend consumes it, changed the identity this repo presents to the vault's audit log (and to any allowlist keyed on it), and pointed the documented connection string at a database that does not exist. None of that is visible from the repo.

**Rule**: before a repo-wide rename, split the hits into **source identity** (package names, imports, doc prose — safe) and **runtime identity** (telemetry service names, auth headers, database names, queue names, metric labels — each a contract with a system outside this repo). Rename the first; for the second, decide deliberately, one at a time, and coordinate with whatever consumes it. A grep count is not a work estimate. The corollary for reviewers: a rename PR whose diff touches an `OTEL_SERVICE_NAME` value or an auth header is doing two things, and the second one needs its own justification.

**Applies to**: any rename of this repo, its packages, or its services. The runtime identifiers listed above still carry the old `ragen-mcp` name deliberately — that is not an oversight, and changing them is a separate, coordinated task.
