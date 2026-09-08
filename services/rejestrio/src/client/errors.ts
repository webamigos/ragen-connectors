/**
 * Typed error taxonomy for RejestrioClient. Tool handlers can switch
 * on `error instanceof RejestrioHttpError` / `RejestrioRateLimitError`
 * etc. and decide whether to retry, surface, or fall back to cache.
 */

export class RejestrioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RejestrioError";
  }
}

export class RejestrioNetworkError extends RejestrioError {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "RejestrioNetworkError";
    this.cause = cause;
  }
}

export class RejestrioHttpError extends RejestrioError {
  readonly status: number;
  readonly body: unknown;
  readonly endpoint: string;

  constructor(
    status: number,
    endpoint: string,
    body: unknown,
    message?: string,
  ) {
    super(
      message ?? `Rejestr.io ${status} on ${endpoint}`,
    );
    this.name = "RejestrioHttpError";
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

export class RejestrioAuthError extends RejestrioHttpError {
  constructor(endpoint: string, body: unknown) {
    super(401, endpoint, body, `Rejestr.io rejected the API key on ${endpoint}`);
    this.name = "RejestrioAuthError";
  }
}

export class RejestrioPlanTierError extends RejestrioHttpError {
  constructor(endpoint: string, body: unknown) {
    super(
      403,
      endpoint,
      body,
      `Rejestr.io plan tier does not include ${endpoint} — upgrade to Premium`,
    );
    this.name = "RejestrioPlanTierError";
  }
}

export class RejestrioRateLimitError extends RejestrioHttpError {
  readonly retryAfterSeconds: number | null;

  constructor(
    endpoint: string,
    body: unknown,
    retryAfterSeconds: number | null,
  ) {
    super(
      429,
      endpoint,
      body,
      `Rejestr.io rate-limited on ${endpoint}${retryAfterSeconds ? ` (retry-after ${retryAfterSeconds}s)` : ""}`,
    );
    this.name = "RejestrioRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RejestrioBudgetExceededError extends RejestrioError {
  constructor(orgId: string, budgetPln: number, spentPln: number) {
    super(
      `Daily Rejestr.io budget exceeded for org ${orgId}: ${spentPln.toFixed(2)}/${budgetPln.toFixed(2)} PLN`,
    );
    this.name = "RejestrioBudgetExceededError";
  }
}

export class RejestrioUnattributedCallError extends RejestrioError {
  constructor() {
    super(
      "Cannot make a paid Rejestr.io call without an organization: " +
        "customer_id must begin with a non-empty organization id " +
        '(expected "{orgId}:{userId}:{provider}"). The daily spend ' +
        "ceiling is enforced per organization, so an unattributable " +
        "call cannot be allowed.",
    );
    this.name = "RejestrioUnattributedCallError";
  }
}

export class RejestrioDisabledError extends RejestrioError {
  constructor() {
    super(
      "Rejestr.io paid calls are disabled via REJESTRIO_DISABLE_PAID_CALLS — serving cache only",
    );
    this.name = "RejestrioDisabledError";
  }
}
