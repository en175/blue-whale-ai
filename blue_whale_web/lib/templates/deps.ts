import { createTemplateRepo, getPrismaClient } from "@blue-whale/persistence";

/** Templates 用例依赖：wire Prisma template repo。 */
export function createTemplatesDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { templates: createTemplateRepo(getPrismaClient(databaseUrl)) };
}
