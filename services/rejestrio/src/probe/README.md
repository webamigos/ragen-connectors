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
service in `ragen-mcp/services/rejestrio/`.

## Running

**Fill in `companies.ts` first.** The array is empty on purpose —
pick three real companies covering the archetypes noted in the
file.

```bash
# Put your key in .env.local, then:
npm run rejestrio:probe                    # full run, cap 5 PLN
npm run rejestrio:probe -- --dry-run       # validate fixtures only, 0 PLN
npm run rejestrio:probe -- --max-cost-pln 10
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
