import { describe, expect, it, vi } from "vitest";
import { BudgetGuard } from "../budget-guard.js";
import type { RequestAuditRepository } from "../request-audit-repo.js";
import {
  RejestrioBudgetExceededError,
  RejestrioDisabledError,
} from "../../client/errors.js";

function fakeAudit(spentPln: number): RequestAuditRepository {
  return {
    spentTodayForOrg: vi.fn(async () => spentPln),
    record: vi.fn(async () => {}),
  } as unknown as RequestAuditRepository;
}

describe("BudgetGuard", () => {
  it("allows a call when (spent + cost) fits under budget", async () => {
    const guard = new BudgetGuard({
      audit: fakeAudit(5),
      defaultDailyBudgetPln: 20,
      disabled: false,
    });
    await expect(guard.assertAllowed("org-1", 0.5)).resolves.toBeUndefined();
  });

  it("throws BudgetExceeded when the call would push past budget", async () => {
    const guard = new BudgetGuard({
      audit: fakeAudit(19.6),
      defaultDailyBudgetPln: 20,
      disabled: false,
    });
    await expect(guard.assertAllowed("org-1", 0.5)).rejects.toBeInstanceOf(
      RejestrioBudgetExceededError,
    );
  });

  it("skips the check when orgId is null (unknown caller)", async () => {
    const audit = fakeAudit(100);
    const guard = new BudgetGuard({
      audit,
      defaultDailyBudgetPln: 20,
      disabled: false,
    });
    await expect(guard.assertAllowed(null, 0.5)).resolves.toBeUndefined();
    expect(audit.spentTodayForOrg).not.toHaveBeenCalled();
  });

  it("kill-switch refuses everything, including free check calls", async () => {
    const guard = new BudgetGuard({
      audit: fakeAudit(0),
      defaultDailyBudgetPln: 20,
      disabled: true,
    });
    await expect(guard.assertAllowed("org-1", 0)).rejects.toBeInstanceOf(
      RejestrioDisabledError,
    );
    await expect(guard.assertAllowed(null, 0.5)).rejects.toBeInstanceOf(
      RejestrioDisabledError,
    );
  });

  it("reports spend and budget back through the error for logging", async () => {
    const guard = new BudgetGuard({
      audit: fakeAudit(20.01),
      defaultDailyBudgetPln: 20,
      disabled: false,
    });
    try {
      await guard.assertAllowed("org-1", 0.5);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RejestrioBudgetExceededError);
      expect(String(err)).toContain("org-1");
      expect(String(err)).toContain("20.00"); // budget formatting
    }
  });
});
