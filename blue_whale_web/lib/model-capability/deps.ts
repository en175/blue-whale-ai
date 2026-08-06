import {
  createModelCapabilityAdminRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

/** ModelCapability 管理端用例依赖：wire Prisma admin repo（IK6T46）。 */
export function createModelCapabilityAdminDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { db: createModelCapabilityAdminRepo(getPrismaClient(databaseUrl)) };
}
