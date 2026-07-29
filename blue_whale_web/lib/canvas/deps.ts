import { createCanvasRepo, createProjectRepo, getPrismaClient } from "@blue-whale/persistence";

/** Canvas 用例依赖：wire project repo（验归属）+ canvas repo。 */
export function createCanvasDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return { project: createProjectRepo(prisma), canvas: createCanvasRepo(prisma) };
}
