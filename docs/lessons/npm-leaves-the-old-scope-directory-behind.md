---
title: 'After renaming a workspace scope, npm leaves the old scope directory in node_modules and stale imports keep resolving'
modules: ['core', 'google', 'clickup', 'hubspot', 'rejestrio']
areas: ['dependencies', 'architecture']
topics: ['npm-workspaces', 'rename', 'node-modules', 'false-green']
---

# After renaming a workspace scope, npm leaves the old scope directory in node_modules and stale imports keep resolving

**Context**: renaming the workspace scope from `@ragen-mcp/*` to `@ragen-connectors/*` meant rewriting every `package.json` name and every import, then re-running `npm install` to relink the workspaces and regenerate the lockfile. The install reported `added 6 packages, removed 5 packages` and the build passed.

**Problem**: `node_modules/@ragen-mcp/` still existed afterwards. npm had removed the symlinks inside it but not the directory itself. In this instance it was empty, so nothing resolved through it — but the failure mode it sets up is the point: while that directory holds live symlinks, an import of `@ragen-mcp/core` that the rename *missed* still resolves, so `build`, `typecheck` and the test suite all pass on a tree that is only half-renamed. The break arrives later, in a container built from a clean checkout, where the old scope directory was never there.

**Rule**: after renaming a package scope, delete the old scope directory from `node_modules` and rebuild before believing a green run. `rm -rf node_modules/@old-scope && npm run build`. A passing build proves nothing until the old resolution path is physically gone — the check is cheap and the alternative is a green local tree that fails only in CI or in a Docker build.

**Applies to**: npm workspaces in this repo, and any scope or package rename. The same reasoning covers a workspace that is *removed* rather than renamed: its symlink may go while its directory stays.
