# ADR-04: Rejestrio uses one service-wide API key, not per-customer OAuth

**Status:** Accepted
**Date:** 2026-09-06 (documenting a decision already in force)

## Context

Google, HubSpot and ClickUp all work the same way: the customer authorizes us,
we store their token in the vault, and every tool call acts as that customer
(ADR-02).

Rejestr.io does not offer that. It is a Polish company-registry API with a
single account-level API key and no OAuth, no per-user authorization, and no
delegated access. There is no customer credential to store, because customers do
not have Rejestr.io accounts — we do.

It also bills per call, in PLN, against that one account.

## Decision

Rejestrio deliberately breaks the pattern:

- **One `REJESTRIO_API_KEY`**, held by the container, used for every call
  regardless of which customer triggered it. No vault involvement at all.
- **The key is sent verbatim** in `Authorization` — no `Bearer` prefix.
- **`BudgetGuard` enforces a per-org daily PLN ceiling.** Every paid call passes
  through it. This is the only thing standing between a caller and our invoice.
- **`REJESTRIO_DISABLE_PAID_CALLS=true`** is a kill switch that serves cached
  data only.
- **The service owns its own Postgres database** (cache, per-call cost audit,
  budget state) — separate from ragen-app's. `prisma migrate deploy` runs on
  boot from the Dockerfile.

## Consequences

**Spend, not data, is the thing to protect here.** For the OAuth services the
worst case is one customer reading another's data. For rejestrio the registry
data is public; the worst case is an unauthorized caller draining a shared
budget. `BudgetGuard` is a security control, not just a cost control, and
`SECURITY.md` lists bypassing it as an in-scope vulnerability.

**Tools still take `customer_id`.** Not to resolve a credential — there isn't
one — but because the budget is enforced per organization and every call is cost
-audited against the caller.

**A cache miss costs money, so caching is correctness.** Any change to cache
keys or TTLs changes the bill. Tests must never hit the live API.

**It is the deliberate exception.** When a new integration cannot do per-customer
auth, this ADR is the precedent — but the default is ADR-02, and an integration
that *could* use OAuth should.
