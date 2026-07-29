import {
  createJobRepo,
  createProjectRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

/** Jobs 用例依赖：wire Prisma job + project repo。 */
export function createJobsDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return {
    jobs: createJobRepo(prisma),
    projects: createProjectRepo(prisma),
  };
}
