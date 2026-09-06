# Rejestr.io contract probe

Paid API. Every real run costs PLN. **Read before running.**

## Why this exists

Rejestr.io's documentation (see `docs/rejestrio/`) describes the
superset of response fields — real responses have nulls, extra
keys, and type coercions the docs don't mention. The probe:

1. Calls each endpoint we plan to use against a curated set of
   test companies.
2. Saves the raw JSON responses to `fixtures/`.
3. Validates each against a Zod schema in `schemas/`.
4. Diffs against the previous fixture to flag API drift.

The captured fixtures become the test corpus for the real MCP
service in `ragen-connectors/services/rejestrio/`.

## Running

**Fill in `companies.ts` first.** The array is empty on purpose —
pick three real companies covering the archetypes noted in the
file.

```bash
# Put your key in services/rejestrio/.env.local, then from this
# workspace (services/rejestrio/):
npm run probe                          # full run, default cap 5 PLN
npm run probe:dry                      # validate fixtures only, 0 PLN
npm run probe -- --max-cost-pln 10     # raise the cost cap
npm run probe -- --dry-run             # same as probe:dry, inline flag
```

Or from the ragen-connectors repo root:

```bash
npm run probe --workspace @ragen-connectors/rejestrio
npm run probe --workspace @ragen-connectors/rejestrio -- --dry-run
```

## Cost

Per full run, 3 companies:
- 5 endpoints × 3 companies × 0.05 PLN = 0.75 PLN
- Up to 2 financial docs × 3 companies × 0.50 PLN = 3.00 PLN
- **Total: ~3.75 PLN**

The probe projects worst-case spend before making any calls and
aborts if it exceeds `--max-cost-pln`.

## Do not

- Never run this in CI with real calls. `--dry-run` is safe.
- Never commit `REJESTRIO_API_KEY` — it lives in `.env.local`
  only.
- Never import anything from this directory into production code
  paths. This is a one-off tool.
