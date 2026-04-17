/**
 * Minimal Rejestr.io HTTP client for the contract probe.
 *
 * Intentionally thin — we want raw responses for fixture capture, not
 * domain models. The real MCP service will have its own client with
 * retries, cache integration, and observability. This one just calls.
 */

const DEFAULT_BASE = 'https://rejestr.io/api/v2';

export type ProbeClientOptions = {
  apiKey: string;
  baseUrl?: string;
};

export class RejestrioProbeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor({ apiKey, baseUrl = DEFAULT_BASE }: ProbeClientOptions) {
    if (!apiKey) {
      throw new Error('Rejestr.io API key is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Perform a GET. Returns raw JSON on 2xx, throws on non-2xx with the
   * response body attached for easier debugging.
   *
   * Note: Rejestr.io uses a bare-token Authorization header (no Bearer
   * prefix). This is non-RFC but it's what the API expects. Do not
   * "fix" this without re-reading docs/rejestrio/.
   */
  async get(path: string, query?: Record<string, string>): Promise<unknown> {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }

    const started = Date.now();
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: this.apiKey,
        Accept: 'application/json',
      },
      // Hard 30s ceiling — real endpoint 11 calls have been observed
      // taking 40s+ for large filings, but those run through the
      // production client. The probe is interactive; bail fast
      // rather than hanging the terminal.
      signal: AbortSignal.timeout(30_000),
    });
    const latencyMs = Date.now() - started;

    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Leave parsed as null — fallthrough to throw path which
        // surfaces the raw body.
      }
    }

    if (!res.ok) {
      const err = new Error(
        `Rejestr.io ${res.status} ${res.statusText} for GET ${url.toString()} — body: ${text.slice(0, 500)}`,
      ) as Error & {
        status: number;
        latencyMs: number;
        body: unknown;
      };
      err.status = res.status;
      err.latencyMs = latencyMs;
      err.body = parsed ?? text;
      throw err;
    }

    return parsed;
  }
}
