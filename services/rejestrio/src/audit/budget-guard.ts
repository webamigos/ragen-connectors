/**
 * Per-org daily budget guard. Tool handlers call this BEFORE kicking
 * off any upstream Rejestr.io call — if the org has already spent
 * their daily budget, we refuse the call fast instead of rediscovering
 * the limit after racking up another 0.50 PLN.
 *
 * Not a rate limiter — orgs can burst however hard they want inside
 * the budget. Purely a cost ceiling.
 *
 * Caveats:
 * - Uses UTC-day boundaries, matching `RequestAuditRepository.
 *   spentTodayForOrg`. If you ever move to local-tz boundaries,
 *   change both together.
 * - Race-y at the margins: two concurrent calls can each pass the
 *   check and together push past the budget. That's fine — we
 *   overshoot by at most `maxEndpointCost × concurrency`, which for
 *   endpoint 11 (0.50 PLN) × 10 concurrent callers is a few PLN.
 *   Not worth a distributed lock.
 * - The kill-switch (`REJESTRIO_DISABLE_PAID_CALLS=true`) is enforced
 *   here too — the guard is the funnel that every paid call passes
 *   through.
 */
import type { RequestAuditRepository } from "./request-audit-repo.js";
import {
  RejestrioBudgetExceededError,
  RejestrioDisabledError,
} from "../client/errors.js";

export type BudgetGuardOptions = {
  audit: RequestAuditRepository;
  defaultDailyBudgetPln: number;
  disabled: boolean;
};

export class BudgetGuard {
  constructor(private readonly opts: BudgetGuardOptions) {}

  /**
   * Check whether this org may make a paid call costing `costPln`.
   * Throws `RejestrioDisabledError` if the kill-switch is on, or
   * `RejestrioBudgetExceededError` if the ceiling is already reached.
   *
   * Passing `orgId = null` skips the check (audit-only / unknown
   * caller). Prefer to always have an orgId — the check only runs
   * when there's something to enforce.
   */
  async assertAllowed(orgId: string | null, costPln: number): Promise<void> {
    if (this.opts.disabled) {
      throw new RejestrioDisabledError();
    }
    if (!orgId) {
      return;
    }
    const spent = await this.opts.audit.spentTodayForOrg(orgId);
    if (spent + costPln > this.opts.defaultDailyBudgetPln) {
      throw new RejestrioBudgetExceededError(
        orgId,
        this.opts.defaultDailyBudgetPln,
        spent,
      );
    }
  }
}
