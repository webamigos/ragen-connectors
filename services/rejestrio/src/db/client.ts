import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let prisma: PrismaClient | null = null;

/**
 * Singleton Prisma client wired via the `pg` adapter (Prisma v7 pattern).
 *
 * Matches `ragen-token-vault/src/db/client.ts` for consistency — any
 * change here is likely wanted there too.
 */
export function getDb(): PrismaClient {
  if (!prisma) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}
