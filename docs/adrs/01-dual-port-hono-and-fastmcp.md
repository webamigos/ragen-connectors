# ADR-01: Two HTTP servers per service, with MCP on `PORT + 1000`

**Status:** Accepted
**Date:** 2026-09-06 (documenting a decision already in force)

## Context

Every service in this repo has to expose two different surfaces:

1. **Ordinary HTTP** — the OAuth flow (`/auth/<provider>`, `/auth/callback`,
   `/auth/status`), a health check, and in Google's case REST endpoints that
   ragen-app's file pickers call directly.
2. **The MCP protocol** — an HTTP-stream endpoint at `/mcp` that the calling
   assistant connects to.

The obvious design is one server with the MCP endpoint mounted as a route. That
is not available to us: FastMCP (the npm package) starts and owns its own HTTP
listener. It has no "give me a handler I can mount on your Hono app" API, so the
two surfaces cannot share a port.

## Decision

Each service runs **two listeners**:

- Hono on `PORT` — OAuth, health, REST
- FastMCP on `PORT + 1000` — the `/mcp` endpoint

The `+ 1000` offset is a convention, not a framework requirement. It exists so
that a service's second port is derivable rather than separately configured, and
so the two allocations never interleave across services.

Current allocation — **keep this table in sync when adding a service**:

| Service   | HTTP | MCP  |
| --------- | ---- | ---- |
| google    | 8001 | 9001 |
| clickup   | 8002 | 9002 |
| hubspot   | 8003 | 9003 |
| rejestrio | 8004 | 9004 |

## Consequences

**A service is not one port.** Every Dockerfile, compose file, Railway service
and reverse-proxy rule has to account for both. Forgetting the MCP port produces
a service that passes its health check and answers `/auth/status` while being
completely unreachable over MCP — which looks like a client bug, not a
deployment one.

**Neither port authenticates by itself.** Hono's OAuth routes are public by
necessity, and the FastMCP port has no session concept — it trusts the
`x-customer-id` header. Both must sit behind an authenticating proxy in any
deployment reachable from outside. This is stated again in `SECURITY.md` because
it is the single most consequential deployment property of this repo.

**The offset is load-bearing but unenforced.** Nothing in code validates that
the MCP port is `PORT + 1000`; `index.ts` computes it. If someone hard-codes a
different value the service still works locally and diverges from every
deployment manifest.

## Alternatives considered

**Reverse-proxy both onto one public port.** Still valid, and what a production
deployment should do — but it does not remove the constraint, it relocates it.
The service itself still binds two ports.

**Replace FastMCP with a hand-rolled MCP transport on Hono.** Would give one
listener, at the cost of owning a protocol implementation that FastMCP already
maintains. Not worth it for the shape of services we run.
