---
name: Bug report
about: Something behaves incorrectly
labels: bug
---

<!-- Security vulnerabilities do NOT belong here — see SECURITY.md. -->

## What happens

## What you expected instead

## How to reproduce

1.
2.
3.

## Which service

- [ ] google
- [ ] clickup
- [ ] hubspot
- [ ] rejestrio
- [ ] `packages/core` (shared)

## Environment

- Version or commit:
- Node version: <!-- must be 24.x -->
- Deployment: <!-- local dev / Docker / Railway -->
- Which tool was called, if any:

## Configuration that might matter

Fill in what applies — **redact all secrets and tokens**:

- Is ragen-token-vault reachable, and did `/health` return OK?
- For rejestrio: `REJESTRIO_PLAN_TIER`, and is `REJESTRIO_DISABLE_PAID_CALLS`
  set?
- Any non-default `*_BASE_URL` or `HUBSPOT_AUTH_DOMAIN`:

## Logs

Relevant output from the service.

**Redact secrets, access tokens, refresh tokens and customer data before
pasting.**

<details>
<summary>Logs</summary>

```
```

</details>

## If this is an OAuth or token problem

- Does `GET /auth/status` report a stored token for that `customer_id`?
- Did the flow fail at `/auth/<provider>`, at the callback, or on first use of
  the token?
- For HubSpot: tokens expire after ~30 minutes and refresh on 401 — does the
  failure survive a second attempt?

## If this is a tool-result problem

- Was the tool response `{success: false, ...}`, or was it `{success: true}`
  with wrong data?
- Does the same call against the provider's own API return the same thing?
