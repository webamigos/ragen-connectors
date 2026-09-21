# create-ragen-connector

Scaffold an MCP server a [Ragen](https://ragen.ai) installation can connect to.

```bash
npx create-ragen-connector Weather
```

## What it writes

Two shapes, chosen from where you run it:

| | Inside a `ragen-connectors` checkout | Anywhere else |
|---|---|---|
| Writes | `services/<slug>/` | `<slug>/`, with `git init` |
| Shared code | `@ragen-connectors/core` | vendored into `src/runtime/` |
| Ports | the next free pair, **and both port tables updated** | 8080 / 9080 |

Everything else — the entrypoint, the tools, the tests, the README — is the
same file in both. Override the choice with `--target=`.

## Flags

Every prompt has one, so this runs in CI.

| Flag | Default |
|---|---|
| *(positional)* | the name; prompted |
| `--slug=` | the name, kebab-cased |
| `--description=` | empty |
| `--auth=` | `server_side` (or `api_key_bearer`) |
| `--port=` | the next free pair in the workspace, else 8080 |
| `--icon=` | `plug` (a [lucide](https://lucide.dev) name) |
| `--target=` | detected |
| `--skip-git` | off |
| `--yes` | accept every default |

## Then connect it

The generated `README.md` has the whole procedure, and `ragen-connector.json`
has the values. In short: a **platform administrator** adds a row at
`/mcp-catalogue` in `apps/admin` — no deploy, no migration, no release of
Ragen ([ADR-52](https://github.com/webamigos/RagenAI/blob/main/docs/adrs/52-the-connector-catalogue-is-data-not-an-enum.md)).

Two things catch people, and the generated README explains both:

- **The URL must end in `/mcp`.** Test connection catches it if you forget.
- **`localhost` is refused**, and the "allow a private address" checkbox does
  not change that — it admits RFC 1918 space and nothing else. Use your LAN
  address for local development.

## What the templates encode

Ragen's client departs from the bare MCP specification in three places, and
every generated connector carries them as compilable code with tests beside it:

1. `customer_id` arrives as a **tool parameter**, not a header. Ragen strips it
   from the schema the model sees and injects the connector's own value.
2. A tool returns `{success}` and **never throws** — a throw reaches the model
   as an opaque protocol error it cannot act on.
3. `authenticate` **refuses nothing**. Ragen's Test connection opens a session
   with no headers at all, so a connector that demanded one would look broken
   at the only moment an operator checks it. Credentials are enforced per tool
   call, as an envelope the model can pass on.

## Auth shapes

`server_side` and `api_key_bearer`. `external_mcp` is refused rather than
generated: FastMCP can serve the OAuth discovery endpoints Ragen's client looks
for, but a generated authorization server nobody can run without their own
provider and client credentials is a checklist in disguise — which is the thing
this CLI exists to replace.

## Developing it

```bash
npm run build -- --filter=create-ragen-connector
npm test                      # from the repository root
```

The tests that matter most are the ones that check the CLI against things
outside it: `vendored-runtime-is-current.test.ts` (the standalone copies
against `packages/core`), `port-table.test.ts` (the parser against the real
`AGENTS.md`), and `render.test.ts`'s "differ only where they must".
