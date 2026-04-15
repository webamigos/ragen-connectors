/**
 * Thin HTTP client for Rejestr.io.
 *
 * Responsibilities:
 *  - `Authorization: <bare-token>` — NOT Bearer. Non-RFC but what the
 *    API wants.
 *  - Retry on 429 with exponential backoff + jitter. Respects
 *    `Retry-After`. Max 3 retries.
 *  - Map HTTP errors to the typed taxonomy in `./errors.ts` so tool
 *    handlers can switch on them.
 *  - Emit a post-call hook so the audit layer can record cost + latency
 *    without this file knowing about the DB.
 *
 * Intentionally does NOT:
 *  - Know about caching (that lives in the repository layer).
 *  - Know about per-org budgets (enforced by the tool handler before
 *    it calls the client).
 *  - Enforce plan-tier gating (callers decide).
 */
import type { EndpointId } from "./endpoints.js";
import { ENDPOINTS } from "./endpoints.js";
import {
  RejestrioAuthError,
  RejestrioHttpError,
  RejestrioNetworkError,
  RejestrioPlanTierError,
  RejestrioRateLimitError,
} from "./errors.js";

/**
 * Per-call metadata carried from the tool handler through the HTTP
 * client and into the audit hook. This is the only way we can
 * attribute cost to the right org — the client doesn't know about
 * auth tenants at construction time.
 */
export type CallContext = {
  orgId?: string | null;
  userId?: string | null;
  krs?: number | null;
  nip?: string | null;
};

export type RejestrioCallOutcome = {
  endpoint: EndpointId;
  httpStatus: number;
  latencyMs: number;
  costPln: number;
  ctx: CallContext;
  error?: unknown;
};

export type RejestrioClientOptions = {
  apiKey: string;
  baseUrl: string;
  /**
   * Post-call hook, invoked on every request attempt — success OR
   * failure. Used by the audit layer to log cost + latency. The
   * hook must not throw (the client rethrows whatever it was about
   * to); errors in the hook are swallowed to avoid masking real
   * upstream errors.
   */
  onCallComplete?: (outcome: RejestrioCallOutcome) => void | Promise<void>;
  /**
   * Max retries on 429 / 5xx. Defaults to 3; the first attempt is
   * not counted as a retry.
   */
  maxRetries?: number;
  /**
   * Per-request timeout in ms. Defaults to 60s — some endpoint 11
   * calls genuinely take >40s for large filings. Do not shrink this
   * without verifying against real fixtures.
   */
  timeoutMs?: number;
};

type FetchLike = typeof globalThis.fetch;

export class RejestrioClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly onCallComplete?: RejestrioClientOptions["onCallComplete"];
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    options: RejestrioClientOptions,
    /**
     * Test-only override for fetch. Production never passes this; the
     * global fetch is used. Kept in the constructor (not a default
     * arg default-ing to globalThis.fetch) so vi.stubGlobal("fetch")
     * still works on the production path.
     */
    fetchImpl?: FetchLike,
  ) {
    if (!options.apiKey) {
      throw new Error("RejestrioClient: apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.onCallComplete = options.onCallComplete;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /**
   * Run a GET request. Callers are responsible for passing the right
   * `endpoint` id so cost is attributed correctly — e.g. pass "01"
   * for `/org?nip=...`, "02" for `/org/{id}`, etc.
   *
   * `ctx` carries the calling org/user + the target company's
   * identifiers so the audit hook can write a single, fully-attributed
   * row per call. Pass an empty object if none of those are known
   * (e.g. a health probe) — don't fake values.
   */
  async get(
    endpoint: EndpointId,
    path: string,
    query?: Record<string, string>,
    ctx: CallContext = {},
  ): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }

    let attempt = 0;
    while (true) {
      const started = Date.now();
      let outcome: RejestrioCallOutcome;
      try {
        const response = await this.fetchWithTimeout(url);
        const latencyMs = Date.now() - started;
        const parsed = await this.parseBody(response);

        outcome = {
          endpoint,
          httpStatus: response.status,
          latencyMs,
          costPln: ENDPOINTS[endpoint].costPln,
          ctx,
        };

        if (response.ok) {
          await this.invokeHook(outcome);
          return parsed;
        }

        // Not OK — construct a typed error.
        const err = this.httpErrorFor(
          response.status,
          endpoint,
          parsed,
          response.headers.get("retry-after"),
        );
        outcome.error = err;

        // Retry 429 / 5xx. Don't retry 4xx-that-isn't-429 — those
        // won't get better.
        const shouldRetry =
          (response.status === 429 || response.status >= 500) &&
          attempt < this.maxRetries;

        await this.invokeHook(outcome);

        if (!shouldRetry) {
          throw err;
        }

        await this.backoff(attempt, err);
        attempt += 1;
        continue;
      } catch (err) {
        // Only wrap unknown errors — typed ones were thrown deliberately above.
        if (err instanceof RejestrioHttpError) {
          throw err;
        }
        const latencyMs = Date.now() - started;
        const wrapped = new RejestrioNetworkError(
          `Rejestr.io ${endpoint} network error: ${(err as Error).message ?? String(err)}`,
          err,
        );
        outcome = {
          endpoint,
          httpStatus: 0,
          latencyMs,
          costPln: 0, // network errors never reached upstream — no charge
          ctx,
          error: wrapped,
        };
        await this.invokeHook(outcome);

        if (attempt < this.maxRetries) {
          await this.backoff(attempt, wrapped);
          attempt += 1;
          continue;
        }
        throw wrapped;
      }
    }
  }

  private async fetchWithTimeout(url: URL): Promise<Response> {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: {
          // Bare-token — no Bearer prefix. See services/rejestrio/docs/.
          Authorization: this.apiKey,
          Accept: "application/json",
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private httpErrorFor(
    status: number,
    endpoint: EndpointId,
    body: unknown,
    retryAfterHeader: string | null,
  ): RejestrioHttpError {
    if (status === 401) {
      return new RejestrioAuthError(endpoint, body);
    }
    if (status === 403) {
      return new RejestrioPlanTierError(endpoint, body);
    }
    if (status === 429) {
      const retryAfter = retryAfterHeader
        ? Number(retryAfterHeader)
        : null;
      return new RejestrioRateLimitError(
        endpoint,
        body,
        Number.isFinite(retryAfter) ? retryAfter : null,
      );
    }
    return new RejestrioHttpError(status, endpoint, body);
  }

  private async backoff(attempt: number, err: unknown): Promise<void> {
    // Exponential backoff: 500ms, 1s, 2s … with ±25% jitter.
    // Respect Retry-After if it's set on a 429.
    let delayMs = 500 * Math.pow(2, attempt);
    if (err instanceof RejestrioRateLimitError && err.retryAfterSeconds) {
      delayMs = Math.max(delayMs, err.retryAfterSeconds * 1000);
    }
    const jitter = delayMs * (Math.random() * 0.5 - 0.25);
    await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
  }

  private async invokeHook(outcome: RejestrioCallOutcome): Promise<void> {
    if (!this.onCallComplete) {
      return;
    }
    try {
      await this.onCallComplete(outcome);
    } catch {
      // Hook failures must not mask the real upstream result. Swallow.
    }
  }
}
