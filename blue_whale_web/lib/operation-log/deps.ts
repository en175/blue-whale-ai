import {
  createOperationLogRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

/** OperationLog 用例依赖：wire Prisma admin_operation_logs repo。 */
export function createOperationLogDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { db: createOperationLogRepo(getPrismaClient(databaseUrl)) };
}
