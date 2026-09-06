---
title: 'FastMCP starts its own HTTP server, so a service that boots cleanly and answers /health can still be unreachable over MCP'
modules: ['google', 'clickup', 'hubspot', 'rejestrio']
areas: ['architecture', 'deployment']
topics: ['fastmcp', 'hono', 'ports', 'docker', 'railway', 'health-checks']
---

# FastMCP starts its own HTTP server, so a service that boots cleanly and answers /health can still be unreachable over MCP

**Context**: each service runs Hono on `PORT` for OAuth and health, and FastMCP on `PORT + 1000` for the `/mcp` endpoint. FastMCP owns its listener and cannot be mounted as a route on the Hono app — that constraint is why there are two ports at all (ADR-01).

**Problem**: every conventional signal of a healthy service reports on the Hono port. The container starts, `/health` returns 200, `/auth/status` answers, Railway marks the deploy live, and the readiness probe is satisfied — while the MCP port is not exposed, not mapped in the compose file, or not open in the proxy. The service is, for its actual purpose, completely down. The symptom appears at the *client*: the assistant cannot list tools. That reads as a client or protocol bug, and the deployment looks green while you debug the wrong thing.

**Rule**: treat a service as two listeners everywhere it is described — Dockerfile `EXPOSE`, compose port maps, Railway config, proxy rules, and any firewall. When an MCP client cannot see a service's tools, check the MCP port is actually reachable (`curl` it) *before* suspecting the client. A health check that only probes `PORT` cannot tell you the service works; if you want a probe that means something, it has to touch `PORT + 1000` too.

**Applies to**: all four services and any new one. The port table lives in [ADR-01](../adrs/01-dual-port-hono-and-fastmcp.md) and in `AGENTS.md` — a new service must claim both, and nothing in code enforces the `+ 1000` convention.
