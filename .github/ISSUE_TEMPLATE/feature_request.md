---
name: Feature request
about: Propose a change, a new tool, or a new service
labels: feature
---

## The problem

What can't you do today, and what does that cost you? Describe the situation
rather than the solution — it often turns out there's a better fix than the one
that first comes to mind.

## What you have in mind

If this is a new MCP tool, say which provider endpoint it wraps and what the
model would do with the result.

## What you've already tried or considered

Including workarounds, and why they aren't enough.

## Who this is for

- [ ] A new provider integration (a whole new service)
- [ ] A new tool on an existing service
- [ ] Self-hosted deployments generally
- [ ] Contributors / developer experience

## Anything else

Links to the provider's API docs for the endpoints involved.

<!--
Every tool in this repo is multi-tenant: it takes a `customer_id` and resolves
credentials per customer through ragen-token-vault. A proposal that needs a
single shared credential for all users, or that can't scope its data by
customer, is unlikely to land as-is — rejestrio is the one deliberate exception
and it exists because the upstream registry has no per-user auth at all.

Note also that some upstreams bill per call. If yours does, say so here so we
can plan the budget guard alongside the tool.
-->
