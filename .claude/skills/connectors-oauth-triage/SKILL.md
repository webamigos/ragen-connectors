---
name: connectors-oauth-triage
description: Diagnose a token, OAuth or ragen-token-vault failure across the google/clickup/hubspot services — where the flow broke, whether it's expiry, HMAC, clock skew or a missing grant, and which layer to look at. Use when a tool returns an auth error, a callback fails, or the vault rejects a request. Triggers on "401", "token expired", "OAuth failed", "auth/callback", "vault", "nie działa autoryzacja", "wygasł token".
---

# Triaging an auth failure

Three layers can fail and they look alike from the tool's `{success: false}`
envelope. Work out which one before changing anything.

```
model → MCP tool → getAccessToken(customerId) → ragen-token-vault → provider API
                          [2]                          [1]              [3]
```

## Step 1: is it us or the vault?

```bash
curl -s localhost:<PORT>/auth/status?customer_id=<id>
```

- **No token stored** → the customer never completed the flow, or it completed
  against a different `customer_id`. Go to step 2.
- **Token stored but the tool still fails** → the credential exists and the
  provider is rejecting it. Go to step 3.
- **The call to the vault itself errors** → layer 1. Read on.

**Vault (layer 1) failures.** Requests are signed HMAC-SHA256 over
`"{ts}\n{method}\n{path}\n{sha256(body)}"` with `X-Service-Name` identifying the
caller. If every route 401s rather than just one:

- Is `RAGEN_TOKEN_VAULT_SERVICE_SECRET` set, and the same secret the vault knows?
- **Clock skew.** The signature embeds a timestamp and the vault rejects
  anything outside its tolerance window. A container with a drifted clock fails
  every request and nothing in the message says "clock".
- Were the vault env vars set **before** the module was imported?
  `ragenVaultClient` is a module-level singleton built at import time — set
  afterwards, it is a client built from `undefined`.
- Note `X-Service-Name` still sends the old `ragen-mcp-*` names deliberately.
  Do not "fix" it; the vault's audit log and any allowlist key on it.

## Step 2: the flow didn't complete

Walk it in order: `/auth/<provider>` → provider consent → `/auth/callback` →
token stored.

- **State missing or expired.** OAuth pending state is in memory with a
  **10-minute TTL** (`saveState`/`popState`). Two things follow: a slow consent
  screen legitimately expires it, and **a restarted process loses it** — so a
  callback that lands after a redeploy always fails. In a multi-replica
  deployment the callback must reach the same replica that started the flow.
- **Redirect URI mismatch.** The registered URI must match exactly.
  **ClickUp strips paths from redirect URIs**, which is why that service
  redirects `/` to `/auth/callback`. If you're adding a provider and the
  callback lands on `/`, this is why.
- **`customer_id` mismatch.** The flow stores under the id it was started with.
  Starting with one and querying with another looks exactly like "no token".

## Step 3: the provider rejects the token

- **HubSpot** — access tokens expire in **~30 minutes**. The service layer
  auto-refreshes on 401 via `refreshAndGetToken()`. If a failure survives a
  second attempt, refresh itself is broken — check the refresh token is still
  stored and the grant hasn't been revoked upstream.
- **ClickUp** — tokens **don't expire** and there is no refresh path. A 401 here
  means the grant was revoked in ClickUp, not that it lapsed. Re-authorize.
- **Google** — PKCE flow. A revoked grant, a scope that was never requested, and
  an expired refresh token all surface as 401/403. Check which scopes the stored
  grant actually carries before assuming the token is stale.

A 403 rather than a 401 usually means the token is fine and the *scope* or the
account's permissions are not — re-authorizing with the same scopes won't help.

## Rules while you debug

- **Never log a token**, not even truncated, not at debug level. Log the
  `customer_id` and the provider.
- **Never paste a real token, secret or signature into an issue.** See
  `SECURITY.md` — if you found a way to read someone else's token, that is a
  private report, not a bug ticket.
- Fix the cause, not the symptom: a `catch` that returns "please re-authorize"
  on every auth error hides expiry, skew and revocation behind one message.
