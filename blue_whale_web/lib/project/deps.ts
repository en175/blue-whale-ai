import { createProjectRepo, getPrismaClient } from "@blue-whale/persistence";

/** Project 用例依赖：wire Prisma project repo。 */
export function createProjectDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { db: createProjectRepo(getPrismaClient(databaseUrl)) };
}
