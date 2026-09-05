# Security Policy

Ragen Connectors holds delegated access to other people's accounts — ClickUp
workspaces, HubSpot CRMs, Google Drive and Calendar. A flaw here can expose a
customer's third-party data, so we take reports seriously and respond on a
stated schedule.

## Reporting a vulnerability

**Do not open a public issue.** Report privately to **ragen@webamigos.pl**, or
through GitHub's [private vulnerability
reporting](https://github.com/webamigos/ragen-connectors/security/advisories/new).

Include what you have — a partial report is better than none:

- what the vulnerability is, and which service or tool it affects
- steps to reproduce, or a proof of concept
- the impact you think it has, and who it affects
- a suggested fix, if you have one

## What to expect

| Step | Timeline |
|---|---|
| Acknowledgement that we received your report | 48 hours |
| Initial assessment and severity classification | 7 days |
| A fix timeline communicated back to you | 14 days |
| Patch released | Critical: as fast as we can. High: 30 days. Medium/low: next release. |

We will keep you updated as it moves, and credit you in the release notes unless
you would rather stay anonymous.

## Scope

**In scope** — anything that lets someone reach data or actions they should not:

- **cross-customer access** — one `customer_id` reaching another's tokens, or a
  tool call resolving credentials for a customer other than the caller. This is
  the bug class we care most about.
- OAuth flow weaknesses: state/PKCE handling, redirect-URI validation, callback
  forgery, authorization-code interception
- anything that lets a caller retrieve, log or exfiltrate an access or refresh
  token, including leakage through error messages, traces or tool responses
- forging or replaying the HMAC-SHA256 signatures used to authenticate against
  ragen-token-vault
- reaching the MCP endpoint without a valid customer context, or escalating the
  scope of what a token can do
- prompt injection through tool *results* — upstream API content (a ClickUp task
  description, a Drive document) that causes the calling assistant to act
  outside its instructions or leak other tool output
- SSRF through configurable upstream URLs, SQL injection in the rejestrio cache,
  RCE, and the rest of the usual list
- billing abuse: a path that bypasses rejestrio's `BudgetGuard` and lets an
  unauthenticated or unauthorized caller spend PLN against the shared API key

**Out of scope:**

- findings that require an attacker to already hold valid credentials for the
  customer they are attacking
- denial of service through sheer volume, and rate-limit tuning
- vulnerabilities in the upstream providers themselves (ClickUp, HubSpot,
  Google, Rejestr.io) — report those to the provider; tell us if our integration
  makes it worse
- results from an automated scanner with no demonstrated exploit
- missing hardening headers with no demonstrated impact

## Deployment note

These services are self-hosted: **you** run them, so you own patching. Watch
releases for security fixes.

Two deployment properties matter more than anything in the code:

- **The MCP and HTTP ports are not authenticated by themselves.** Each service
  listens on `PORT` (Hono) and `PORT + 1000` (FastMCP). Neither is safe to
  expose directly to the internet — put them behind your own authenticating
  proxy, and treat `x-customer-id` as trusted only because that proxy set it.
- **`REJESTRIO_API_KEY` is service-wide.** It is a single shared credential held
  by the container, not a per-user one. Anyone who can reach the rejestrio
  service can spend against it, bounded only by `BudgetGuard`.

A vulnerability in a dependency of your own deployment (your Postgres, your
reverse proxy) is yours to patch, not ours — but tell us if our defaults made it
worse, because that is a bug in our defaults.
