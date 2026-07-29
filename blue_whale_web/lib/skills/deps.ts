import { createSkillRepo, getPrismaClient } from "@blue-whale/persistence";

/** Skills 用例依赖：wire Prisma skill repo。 */
export function createSkillsDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { skills: createSkillRepo(getPrismaClient(databaseUrl)) };
}
