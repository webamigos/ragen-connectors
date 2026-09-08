---
title: 'Turbo will not resolve a workspace without an exact package-manager version, and the modern field is the riskier way to give it one'
modules: ['ci']
areas: ['dependencies', 'ci']
topics: ['turborepo', 'npm', 'devengines', 'packagemanager', 'node-24']
---

# Turbo will not resolve a workspace without an exact package-manager version, and the modern field is the riskier way to give it one

**Context**: adopting Turborepo (ADR-06). `turbo.json` was written, the root scripts were pointed at `turbo run`, and the first build was run.

**Problem**: turbo 2.10 refused outright — `Could not resolve workspace. Missing devEngines.packageManager or legacy packageManager field in package.json`. It does not infer the package manager from `package-lock.json`. Worse, it rejects a semver *range*: `devEngines.packageManager: {name: "npm"}` and `{name: "npm", version: ">=10"}` were both `Invalid`; only an exact version is accepted. That forces a choice between two fields that behave very differently. `devEngines.packageManager` is validated by npm itself at install time and fails the install on a mismatch — so pinning `11.19.0` there means CI breaks the day its Node 24 patch bumps npm to 11.20. The legacy `packageManager` field is inert unless Corepack is enabled, so a drifting version costs nothing.

**Rule**: use the legacy `"packageManager": "npm@<exact>"` field for turbo, not `devEngines.packageManager`. Pin it to the npm bundled with the Node version in `.nvmrc` — for Node 24.20.0 that is npm 11.19.0 (`curl -s https://nodejs.org/dist/index.json` lists the pairing). Treat it as documentation that turbo happens to read, not as an enforcement mechanism, and do not "modernize" it to `devEngines` without deciding what should happen when CI's npm drifts.

**Applies to**: the root `package.json`. Re-check the pinned version when `.nvmrc` moves to a new Node major.
