import { createTopupTierRepo, getPrismaClient } from "@blue-whale/persistence";

/** TopupTier 用例依赖：wire Prisma topup_tiers repo。 */
export function createTopupTierDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { db: createTopupTierRepo(getPrismaClient(databaseUrl)) };
}
