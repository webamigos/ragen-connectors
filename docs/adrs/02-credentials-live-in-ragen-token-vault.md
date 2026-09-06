# ADR-02: Credentials live in ragen-token-vault, services stay stateless

**Status:** Accepted
**Date:** 2026-09-06 (documenting a decision already in force)

## Context

These services act on behalf of many customers against third-party APIs. Each
customer authorizes us separately, so every service needs a per-customer access
token — and for HubSpot and Google, a refresh token too.

Storing those tokens in each service would mean four services each owning a
credential store, each encrypting at rest, each getting key rotation right.
Four chances to get the same hard problem wrong, and four databases to breach.

## Decision

**No service stores a credential.** Tokens live in
[ragen-token-vault](https://github.com/webamigos/ragen-token-vault), which
encrypts them with AES-256-GCM and is shared with ragen-app.

Services reach it through `RagenVaultClient` in `packages/core`, which signs
every request with HMAC-SHA256 over
`"{timestamp}\n{method}\n{path}\n{sha256(body)}"` and identifies itself with an
`X-Service-Name` header.

Two consequences follow directly:

- **Every MCP tool takes a `customer_id` parameter** and resolves its credential
  through `getAccessToken(customerId)` at call time.
- **OAuth pending state is the one exception.** The short-lived state between
  `/auth/<provider>` and `/auth/callback` is kept in memory with a 10-minute TTL
  (`saveState()` / `popState()` in core), because it is worthless after the
  callback and does not justify a database.

## Consequences

**The vault is a hard dependency.** If it is unreachable, every tool that needs
a token fails — there is no local fallback and deliberately no cache. A service
that appears healthy can be entirely non-functional; `/health` does not probe
the vault.

**`RagenVaultClient` is a module-level singleton constructed at import time**
from `RAGEN_TOKEN_VAULT_URL` and `RAGEN_TOKEN_VAULT_SERVICE_SECRET`. Those
variables must be set *before* the module is imported. This is a real ordering
trap: importing the client from a module that loads before env validation gives
you a client built from `undefined`.

**Never cache a token in module scope.** It is per-customer state in a
multi-tenant process; a module-level variable is shared across every customer
the process serves. Resolve per call.

**The HMAC format is a cross-repo contract.** ragen-app and this repo each
construct that signature string independently. Changing it here breaks
authentication for both at once — see the vault's own CONTRIBUTING.md.

## Alternatives considered

**A shared library that talks to the database directly.** Rejected: it spreads
decryption keys to every service, so a compromise of the least-sensitive service
yields every customer's tokens.

**Per-service token storage.** Rejected for the reasons in Context — the same
hard problem solved four times, with four blast radii.
