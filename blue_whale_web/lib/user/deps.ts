import { createUserRepo, getPrismaClient } from "@blue-whale/persistence";

/** User 用例依赖：wire Prisma user repo。 */
export function createUserDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { users: createUserRepo(getPrismaClient(databaseUrl)) };
}
