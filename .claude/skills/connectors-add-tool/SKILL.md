---
name: connectors-add-tool
description: Add or change an MCP tool on one of these services — the envelope contract, per-customer credential resolution, Zod parameters, and what a reviewer will check. Use when writing a new tool, editing an existing one, or reviewing either. Triggers on "add a tool", "new MCP tool", "addTool", "nowe narzędzie", "dodaj tool".
---

# Adding an MCP tool here

A tool is called by a language model, not by application code. That changes what
"handle the error" means, and it is where most mistakes in this repo happen.

## The four rules

**1. It never throws.** Every path returns a JSON string:

```ts
JSON.stringify({ success: true,  /* payload */ })
JSON.stringify({ success: false, error: "..." })
```

A throw reaches the model as an opaque protocol error. `{success: false}` with a
sentence it can relay is the difference between the model retrying sensibly and
the model giving up. Wrap the whole handler body, not just the fetch.

**2. It takes `customer_id`, and resolves the credential per call.**

```ts
const token = await getAccessToken(customer_id);
```

Never hoist that into module scope, a closure, or a `Map` keyed by anything.
The process serves every customer; a cached token is a cross-customer leak, and
it is the bug class `SECURITY.md` puts first.

**3. Parameters are a Zod schema.** The schema is what the model sees, so the
`.describe()` text is documentation *for the caller*, not for you. Vague
descriptions produce wrong calls.

**4. Outbound HTTP is native `fetch` with a timeout.**

```ts
await fetch(url, { signal: AbortSignal.timeout(30_000), headers });
```

No axios. An un-timed-out fetch against a hung upstream holds the tool call open
until the client gives up.

## The error message is a user-facing string

It is relayed to a person by the model. Write what went wrong in terms of what
they asked for:

```ts
// no
error: `Request failed with status code 404`
// yes
error: `No task with id ${taskId} in this ClickUp workspace — it may have been deleted, or belong to a different workspace.`
```

Log the underlying error *before* shaping the envelope. Otherwise a bug in your
own `catch` block produces a plausible-looking failure response and you will
debug the upstream instead of your code.

## Where the code goes

- `src/tools/<area>-tools.ts` — the tool definition and its Zod schema.
- `src/services/<area>.ts` — the HTTP call. Tools stay thin; if a tool is
  building URLs and parsing responses, that belongs in the service layer.
- Register via `register*Tools(mcp: FastMCP)` and call it from `index.ts`.

## Before you open the PR

```bash
npm run lint && npm run typecheck && npm test
```

Add a test for the `{success: false}` path, not just the happy one — it is the
branch that actually ships to the model, and the one nobody exercises by hand.
Mock the upstream; never hit a live API.

## If the upstream bills per call

Stop and read `.claude/skills/connectors-paid-api-calls/SKILL.md` first. On
rejestrio every paid call must pass through `BudgetGuard`, and a tool that
bypasses it is a security finding, not a style problem.
