# ADR-03: MCP tools return a JSON envelope and never throw

**Status:** Accepted
**Date:** 2026-09-06 (documenting a decision already in force)

## Context

An MCP tool is called by a language model, not by application code. When a tool
throws, FastMCP surfaces it as a protocol-level error: the model sees that the
call failed, but not *why*, and has nothing structured to reason about or relay
to the user. "The tool errored" is a dead end; "that task ID doesn't exist in
this workspace" is something the model can act on.

Upstream failures here are routine rather than exceptional — an expired token, a
404 on a deleted record, a rate limit, a daily budget ceiling. Treating them as
exceptions makes the common case the error path.

## Decision

Every tool returns a JSON string, always:

```ts
JSON.stringify({ success: true,  /* ...payload */ })
JSON.stringify({ success: false, error: "human-readable explanation" })
```

Tools catch their own failures. Nothing propagates out of a tool handler.

The `error` string is written for the model to read and relay, so it says what
went wrong in terms of the caller's request — not `Request failed with status
code 401`.

## Consequences

**`success: false` is not an exception, so nothing else notices it.** No
alerting, retry or circuit-breaking happens for free. Anything that needs to be
observed has to be logged explicitly on the way out.

**Structured failure detail has to be deliberate.** The envelope is
`{success, error}`; where a caller needs to distinguish "not found" from "no
permission", that distinction belongs in the payload rather than in a thrown
type.

**A bug in the catch block is invisible.** A `catch` that swallows and returns a
generic message turns a genuine defect into a plausible-looking tool response.
Log the real error before shaping the envelope.

**Reviewers must check for it.** Nothing enforces the rule — a tool that throws
compiles and passes typecheck. It is on the PR checklist for that reason.
