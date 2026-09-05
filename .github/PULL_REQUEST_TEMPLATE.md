<!-- PRs target `dev`. See CONTRIBUTING.md. -->

## What and why

What changed, and what problem it solves. If there's an issue, link it with
`Fixes #123`.

## How it was verified

What you actually ran, and what it said.

## Checklist

- [ ] Targets `dev`
- [ ] `npm run build` passes (run it **before** typecheck — services compile
      against core's `dist/`)
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Tests added or updated for the changed behaviour
- [ ] **If this adds or changes an MCP tool:** it takes `customer_id`, resolves
      credentials per-customer, and returns `{success: …}` JSON rather than
      throwing
- [ ] **If this touches `packages/core`:** every service still builds — core is
      a shared dependency, not a service-local change
- [ ] **If this adds a local import:** it uses a `.js` extension (ESM-only)
- [ ] **If this touches the rejestrio service:** paid calls still pass through
      `BudgetGuard`, and no test consumes live API quota
- [ ] **If this adds a new service or changes a port:** the port table in
      `CLAUDE.md` is updated, and MCP is `PORT + 1000`
- [ ] **If this adds an env var:** it's in the service's `.env.example` and in
      the boot-time validation
- [ ] Docs updated where the change makes them wrong (README, CLAUDE.md)
