/**
 * Persistent audit log of every upstream Rejestr.io call and every
 * cache hit. The `costPln` column is the only way we can answer
 * "what did Rejestr.io cost us this month, and which org is driving
 * the bill" — so this is non-optional.
 */
import type { PrismaClient } from "../generated/prisma/client.js";
import type { EndpointId } from "../client/endpoints.js";

export type AuditRecord = {
  endpoint: EndpointId;
  httpStatus: number;
  latencyMs: number;
  costPln: number;
  orgId?: string | null;
  userId?: string | null;
  krs?: number | null;
  nip?: string | null;
  cached?: boolean;
  error?: string | null;
};

export class RequestAuditRepository {
  constructor(private readonly db: PrismaClient) {}

  async record(entry: AuditRecord): Promise<void> {
    await this.db.requestAudit.create({
      data: {
        endpoint: entry.endpoint,
        httpStatus: entry.httpStatus,
        latencyMs: entry.latencyMs,
        costPln: entry.costPln,
        orgId: entry.orgId ?? null,
        userId: entry.userId ?? null,
        krs: entry.krs ?? null,
        nip: entry.nip ?? null,
        cached: entry.cached ?? false,
        error: entry.error ?? null,
      },
    });
  }

  /** Sum of cost_pln for an org in the current UTC day. Drives the
   *  per-org daily budget guard in tool handlers. */
  async spentTodayForOrg(orgId: string): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const rows = await this.db.requestAudit.aggregate({
      where: { orgId, createdAt: { gte: start } },
      _sum: { costPln: true },
    });
    return rows._sum.costPln ?? 0;
  }
}
