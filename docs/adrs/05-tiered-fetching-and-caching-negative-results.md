# ADR-05: Tiered fetching, and caching the "unavailable" answer

**Status:** Accepted
**Date:** 2026-09-06 (documenting a decision already in force)

## Context

`get_financials` on the rejestrio service can be answered two ways:

- The **basic-data** response we already fetched and cached contains
  `ostatnie_sprawozdanie.glowne_pola` — the headline figures of the most recent
  filing. Reading it costs nothing.
- The **historical series** needs endpoint 10/11, billed up to 0.50 PLN per
  year requested.

Always taking the second path bills for data most callers do not need. Always
taking the first silently answers a question about a five-year trend with a
single year.

There is a second problem underneath. Some filings are scans with no structured
data: the document exists, `czy_ma_json` is `false`, and there is nothing to
return. Without special handling, that call is billed, returns nothing, is not
cached because there is no result to cache — and is billed again on every
retry, forever.

## Decision

**Tier the fetch.** Tier 1 answers from the cached basic-data response at no
cost. Tier 2 hits the paid endpoint, and only when the caller actually needs the
historical series.

**Cache the negative result.** When a document returns `czy_ma_json: false`, the
tool returns `null` for that year *and records it in the cache as
`unavailable`*. A later request for the same year reads that marker instead of
paying again.

## Consequences

**"No data" is a cacheable fact, not an error.** This is the generalizable part
of this ADR: against a billed API, an authoritative negative answer is worth
money and must be stored. Any new paid endpoint should decide, explicitly, what
its `unavailable` marker looks like before it ships.

**The cache is now part of the cost model.** Clearing it, changing its keys, or
shortening a TTL re-bills everything it held — including the negatives. Cache
changes on this service are billing changes and should be reviewed as such.

**An `unavailable` marker can go stale.** If a filing is later re-published with
structured data, the cached negative hides it. That is an accepted trade: the
marker is cheap to invalidate deliberately, and re-checking every negative on
every call is what this ADR exists to prevent.

**Tier 1 and tier 2 can disagree.** Tier 1 reflects whatever was cached with the
basic-data response; tier 2 is fetched fresh. A caller comparing the latest year
across both paths may see different values at different times.
