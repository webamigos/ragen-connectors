---
name: connectors-paid-api-calls
description: Work safely on the rejestrio service, where every upstream call bills real PLN against one shared account key — budget guard, cost audit, tiered fetching, caching negative results, and the kill switch. Use before changing anything that can issue a billed call, touch cache keys or TTLs, or run the probe. Triggers on "rejestrio", "budget guard", "paid call", "KRS", "koszty API", "limit budżetu".
---

# Working on a service that spends money

rejestrio is not like the other three. There is no per-customer OAuth: one
`REJESTRIO_API_KEY`, held by the container, billed per call in PLN against our
account (ADR-04). The registry data is public, so the asset to protect is not
data — it is **spend**.

That reframes several things:

- `BudgetGuard` (`src/audit/budget-guard.ts`) is a **security control**.
  Bypassing it is an in-scope vulnerability in `SECURITY.md`, not a style nit.
- **Caching is correctness, not optimization.** A cache miss costs money, so
  changing cache keys or TTLs is a billing change and should be reviewed as one.
- A retry loop is a spend multiplier.

## Before you write the call

1. **Can it be answered from cache, or from data already fetched?** `get_financials`
   is two-tier for exactly this reason: tier 1 reads
   `ostatnie_sprawozdanie.glowne_pola` out of the already-cached basic-data
   response at no cost; tier 2 hits the billed endpoint only when the caller
   actually needs the historical series (ADR-05).
2. **Does it go through `BudgetGuard`?** Every paid path must. Per-org daily PLN
   ceiling, enforced before the call, not after.
3. **Is it recorded in the cost audit?** Every billed call is attributed to the
   caller.
4. **What is the "no data" answer, and is it cached?** This is the one people
   miss. Some filings are scans: `czy_ma_json: false`, nothing to return. If you
   don't store that as `unavailable`, every retry re-bills for the same nothing,
   forever (ADR-05). An authoritative negative is a result worth money — cache it.

## Developing without spending

```bash
REJESTRIO_DISABLE_PAID_CALLS=true    # serve cache only — use this by default
npm run probe:dry                    # probe without issuing billed calls
```

`REJESTRIO_PLAN_TIER` controls which endpoints the client will even attempt.

## Tests

**Never hit the live API from a test.** Not once, not "just to check the shape".
Mock the client. The existing suite mocks the budget guard too, so a test can
assert that a tool refuses when the ceiling is reached — write that assertion;
it is the branch that protects the invoice.

## The guard only guards an attributed call

`BudgetGuard.assertAllowed(orgId, cost)` **returns early when `orgId` is
null** — there is no org to bill, so there is no ceiling to check. That makes
the ceiling only as strong as `parseCustomerId()`, which derives the org from
the first `:`-separated segment of `customer_id` and yields `null` when that
segment is empty.

So a caller is inside the budget only if their `customer_id` actually parses to
an org. Treat "the guard was called" and "the guard enforced something" as
different claims, and check the second when reviewing a paid path.

## Reviewing a change here

- Does any new code path reach the upstream without passing `BudgetGuard`?
- Can `orgId` be null on that path? If so the ceiling does not apply — reject
  before the billed call rather than proceeding unattributed.
- Does a retry, a loop, or a `Promise.all` turn one logical lookup into N billed
  calls?
- Does a changed cache key silently orphan everything cached under the old one?
  That is a re-bill of the whole cache.
- Does a negative result still get cached as `unavailable`?
- Did a test start hitting the network?
