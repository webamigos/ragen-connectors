/**
 * Rejestr.io contract probe.
 *
 * Run (from this workspace):
 *   npm run probe -- --max-cost-pln 5
 *   npm run probe -- --dry-run
 *
 * Or from ragen-connectors repo root:
 *   npm run probe --workspace @ragen-connectors/rejestrio -- --dry-run
 *
 * What it does:
 *   1. For each company in companies.ts, call each endpoint we care
 *      about, save the raw JSON response to fixtures/, and validate
 *      against the paired Zod schema in schemas/.
 *   2. If a previous fixture exists, compare keys — flag drift.
 *   3. At the end, print total cost + schema violations + drift
 *      report.
 *
 * This script is NEVER run in CI with real API calls. The --dry-run
 * mode is safe (no network, no cost) and suitable for CI gating on
 * fixture/schema consistency.
 *
 * Env is loaded by the runtime via `--env-file=.env.local` (see the
 * `probe` npm script in this workspace's package.json). No `dotenv`
 * package dependency.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RejestrioProbeClient } from './client.js';
import { TEST_COMPANIES, type TestCompany } from './companies.js';
import {
  ENDPOINT_COST_PLN,
  ENDPOINT_SCHEMAS,
  type EndpointId,
} from './schemas/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Financial documents per company: cap how many of the most recent
// docs we pull via the expensive endpoint 11 (0.50 PLN each).
const MAX_FIN_DOCS_PER_COMPANY = 2;

/**
 * Endpoints 10 and 11 are Premium-only. Default plan tier is `base`,
 * so we skip them. Flip via REJESTRIO_PLAN_TIER=premium in .env.local
 * once the account is upgraded.
 */
const PLAN_TIER = (process.env.REJESTRIO_PLAN_TIER ?? 'base').toLowerCase();
const INCLUDE_FINANCIALS = PLAN_TIER === 'premium' || PLAN_TIER === 'biznes';

/**
 * Rejestr.io's `{id}` path param wants the KRS as an integer with no
 * leading zeros. Humans (and our TestCompany.krs field) keep the
 * 10-digit zero-padded form. Convert here, validate the result.
 */
function toApiKrs(krs: string): string {
  if (!/^\d{1,10}$/.test(krs)) {
    throw new Error(`Invalid KRS "${krs}" — must be 1–10 digits`);
  }
  const stripped = krs.replace(/^0+/, '');
  return stripped.length > 0 ? stripped : '0';
}

type Args = {
  maxCostPln: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { maxCostPln: 5, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--max-cost-pln') {
      const v = Number(argv[i + 1]);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error('--max-cost-pln requires a non-negative number');
      }
      out.maxCostPln = v;
      i += 1;
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: rejestrio-probe [--max-cost-pln <n>] [--dry-run]\n' +
          '  --max-cost-pln <n>   hard cap on projected PLN spend (default 5)\n' +
          '  --dry-run            skip all HTTP calls; validate existing fixtures only',
      );
      process.exit(0);
    }
  }
  return out;
}

type CallResult = {
  endpoint: EndpointId;
  fixtureKey: string;
  company: TestCompany;
  status: 'ok' | 'schema-violation' | 'http-error' | 'skipped-dry-run';
  costPln: number;
  latencyMs?: number;
  schemaErrors?: z.ZodError;
  httpError?: string;
  driftedKeys?: string[];
};

function fixturePath(endpoint: EndpointId, key: string): string {
  return path.join(FIXTURES_DIR, `${endpoint}-${key}.json`);
}

function topLevelKeys(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).sort();
  }
  return [];
}

/** Detect added/removed top-level keys between previous and current fixture. */
function detectDrift(prev: unknown, next: unknown): string[] {
  const prevKeys = new Set(topLevelKeys(prev));
  const nextKeys = new Set(topLevelKeys(next));
  const drifted: string[] = [];
  for (const k of nextKeys) {
    if (!prevKeys.has(k)) {
      drifted.push(`+${k}`);
    }
  }
  for (const k of prevKeys) {
    if (!nextKeys.has(k)) {
      drifted.push(`-${k}`);
    }
  }
  return drifted;
}

async function captureAndValidate(
  client: RejestrioProbeClient | null,
  endpoint: EndpointId,
  urlPath: string,
  query: Record<string, string> | undefined,
  company: TestCompany,
  fixtureKey: string,
  dryRun: boolean,
): Promise<CallResult> {
  const filePath = fixturePath(endpoint, fixtureKey);
  const schema = ENDPOINT_SCHEMAS[endpoint];
  const costPln = dryRun ? 0 : ENDPOINT_COST_PLN[endpoint];

  if (dryRun) {
    if (!existsSync(filePath)) {
      return {
        endpoint,
        fixtureKey,
        company,
        status: 'skipped-dry-run',
        costPln: 0,
      };
    }
    const fixture = JSON.parse(await readFile(filePath, 'utf8'));
    const parsed = schema.safeParse(fixture);
    return {
      endpoint,
      fixtureKey,
      company,
      status: parsed.success ? 'ok' : 'schema-violation',
      costPln: 0,
      schemaErrors: parsed.success ? undefined : parsed.error,
    };
  }

  if (!client) {
    throw new Error('client must be set when dryRun=false');
  }

  // Read previous fixture (if any) for drift comparison.
  let prev: unknown = null;
  if (existsSync(filePath)) {
    try {
      prev = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      prev = null;
    }
  }

  let response: unknown;
  const started = Date.now();
  try {
    response = await client.get(urlPath, query);
  } catch (err) {
    return {
      endpoint,
      fixtureKey,
      company,
      status: 'http-error',
      costPln,
      httpError: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
  const latencyMs = Date.now() - started;

  await mkdir(FIXTURES_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(response, null, 2) + '\n', 'utf8');

  const parsed = schema.safeParse(response);
  const driftedKeys = prev ? detectDrift(prev, response) : [];

  return {
    endpoint,
    fixtureKey,
    company,
    status: parsed.success ? 'ok' : 'schema-violation',
    costPln,
    latencyMs,
    schemaErrors: parsed.success ? undefined : parsed.error,
    driftedKeys: driftedKeys.length > 0 ? driftedKeys : undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (TEST_COMPANIES.length === 0) {
    console.error(
      '✗ TEST_COMPANIES is empty. Edit src/probe/companies.ts and add at least one entry.',
    );
    process.exit(2);
  }

  // Budget projection: worst case is every endpoint hits + every
  // financial-doc hits. Financials skipped on base plan. Fail-closed
  // if projection exceeds the cap.
  const perCompanyProjected =
    ENDPOINT_COST_PLN['01'] +
    ENDPOINT_COST_PLN['02'] +
    ENDPOINT_COST_PLN['03'] +
    ENDPOINT_COST_PLN['06'] +
    (INCLUDE_FINANCIALS
      ? ENDPOINT_COST_PLN['10'] +
        MAX_FIN_DOCS_PER_COMPANY * ENDPOINT_COST_PLN['11']
      : 0);
  const projected = perCompanyProjected * TEST_COMPANIES.length;

  if (!args.dryRun && projected > args.maxCostPln) {
    console.error(
      `✗ Projected cost ${projected.toFixed(2)} PLN exceeds --max-cost-pln ${args.maxCostPln.toFixed(2)}. ` +
        'Raise the cap or trim TEST_COMPANIES / MAX_FIN_DOCS_PER_COMPANY.',
    );
    process.exit(2);
  }

  let client: RejestrioProbeClient | null = null;
  if (!args.dryRun) {
    const apiKey = process.env.REJESTRIO_API_KEY;
    if (!apiKey) {
      console.error(
        '✗ REJESTRIO_API_KEY missing. Put it in .env.local or export before running.',
      );
      process.exit(2);
    }
    client = new RejestrioProbeClient({
      apiKey,
      baseUrl: process.env.REJESTRIO_BASE_URL,
    });
  }

  const results: CallResult[] = [];
  let totalSpent = 0;

  for (const company of TEST_COMPANIES) {
    const label = `[${company.archetype}] KRS ${company.krs} / NIP ${company.nip}`;
    console.log(`\n── ${label} ──`);

    // 01 — search by NIP. Skipped if NIP absent (e.g. an insolvent
    // entity we only know by KRS).
    if (company.nip) {
      const r01 = await captureAndValidate(
        client,
        '01',
        '/org',
        { nip: company.nip },
        company,
        `nip-${company.nip}`,
        args.dryRun,
      );
      results.push(r01);
      totalSpent += r01.costPln;
      printLine(r01);
    } else {
      console.log(`  –  01  nip-<missing>  (skipped: no NIP on this company)`);
    }

    const apiKrs = toApiKrs(company.krs);
    // Fixture filenames keep the zero-padded canonical form, so
    // `ls fixtures/` reads naturally and sorts predictably.
    const fixtureKey = `krs-${company.krs}`;

    // 02 — basic org data
    const r02 = await captureAndValidate(
      client,
      '02',
      `/org/${apiKrs}`,
      undefined,
      company,
      fixtureKey,
      args.dryRun,
    );
    results.push(r02);
    totalSpent += r02.costPln;
    printLine(r02);

    // 03 — advanced (chapter 'ogolny' — base-plan, richest general
    // data). Premium chapters 'oddzialy', 'zobowiazania',
    // 'przeksztalcenia' are intentionally not probed here.
    const r03 = await captureAndValidate(
      client,
      '03',
      `/org/${apiKrs}/krs-rozdzialy/ogolny`,
      undefined,
      company,
      `${fixtureKey}-ogolny`,
      args.dryRun,
    );
    results.push(r03);
    totalSpent += r03.costPln;
    printLine(r03);

    // 06 — powiązania (path is `krs-powiazania`, with the `krs-`
    // prefix — NOT just `powiazania`).
    const r06 = await captureAndValidate(
      client,
      '06',
      `/org/${apiKrs}/krs-powiazania`,
      undefined,
      company,
      fixtureKey,
      args.dryRun,
    );
    results.push(r06);
    totalSpent += r06.costPln;
    printLine(r06);

    // 10 — list of financial documents (Premium-only). Skipped on
    // base plan to avoid a guaranteed 403 + useless 0.05 PLN burn.
    if (INCLUDE_FINANCIALS) {
      const r10 = await captureAndValidate(
        client,
        '10',
        `/org/${apiKrs}/krs-dokumenty`,
        undefined,
        company,
        fixtureKey,
        args.dryRun,
      );
      results.push(r10);
      totalSpent += r10.costPln;
      printLine(r10);

      // 11 — single financial doc (up to MAX_FIN_DOCS_PER_COMPANY of
      // the most recent across all filing periods). Only fires if
      // endpoint 10 returned a valid doc list. Skipped entirely on
      // dry-run.
      if (!args.dryRun && r10.status === 'ok') {
        const periods = JSON.parse(
          await readFile(fixturePath('10', fixtureKey), 'utf8'),
        ) as Array<{
          dokumenty?: Array<{ id: number; nazwa?: string; czy_ma_json?: boolean }>;
        }>;
        // Prefer `czy_ma_json: true` — those are the docs that
        // actually return structured JSON. Without this filter, we'd
        // burn 0.50 PLN per call on GPW-style filings that give null.
        // Fall back to all docs only when no JSON-bearing doc exists,
        // so we still capture the null-response fixture for coverage.
        const allDocs = periods.flatMap((p) => p.dokumenty ?? []);
        const jsonDocs = allDocs.filter((d) => d.czy_ma_json === true);
        const candidates = jsonDocs.length > 0 ? jsonDocs : allDocs.slice(0, 1);
        const docs = candidates.slice(0, MAX_FIN_DOCS_PER_COMPANY);
        for (const doc of docs) {
          const r11 = await captureAndValidate(
            client,
            '11',
            `/org/${apiKrs}/krs-dokumenty/${doc.id}`,
            undefined,
            company,
            `${fixtureKey}-doc-${doc.id}`,
            false,
          );
          results.push(r11);
          totalSpent += r11.costPln;
          printLine(r11);
        }
      }
    } else {
      console.log(
        `  –  10  ${fixtureKey}  (skipped: REJESTRIO_PLAN_TIER=${PLAN_TIER}, Premium required)`,
      );
    }
  }

  // Summary
  console.log('\n═══ Summary ═══');
  const violations = results.filter((r) => r.status === 'schema-violation');
  const httpErrors = results.filter((r) => r.status === 'http-error');
  const drifted = results.filter(
    (r) => r.driftedKeys && r.driftedKeys.length > 0,
  );

  console.log(`Total calls:        ${results.length}`);
  console.log(`Total spent (PLN):  ${totalSpent.toFixed(2)}`);
  console.log(`Schema violations:  ${violations.length}`);
  console.log(`HTTP errors:        ${httpErrors.length}`);
  console.log(`Fixtures drifted:   ${drifted.length}`);

  for (const r of violations) {
    console.log(
      `\n  schema-violation  ${r.endpoint}/${r.fixtureKey}\n    ` +
        (r.schemaErrors?.issues ?? [])
          .slice(0, 10)
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('\n    '),
    );
  }
  for (const r of drifted) {
    console.log(
      `  drift             ${r.endpoint}/${r.fixtureKey}  ${r.driftedKeys!.join(', ')}`,
    );
  }

  if (violations.length > 0 || httpErrors.length > 0) {
    process.exit(1);
  }
}

function printLine(r: CallResult): void {
  const badge =
    r.status === 'ok'
      ? '✓'
      : r.status === 'skipped-dry-run'
        ? '–'
        : r.status === 'http-error'
          ? '✗ http'
          : '✗ schema';
  const cost = r.costPln > 0 ? ` ${r.costPln.toFixed(2)} PLN` : '';
  const latency =
    r.latencyMs !== undefined ? ` ${r.latencyMs}ms` : '';
  const drift =
    r.driftedKeys && r.driftedKeys.length > 0
      ? `  drift: ${r.driftedKeys.join(', ')}`
      : '';
  const httpErr = r.httpError ? `  ${r.httpError.slice(0, 120)}` : '';
  console.log(
    `  ${badge}  ${r.endpoint}  ${r.fixtureKey}${cost}${latency}${drift}${httpErr}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
