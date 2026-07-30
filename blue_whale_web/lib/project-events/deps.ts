import {
  createProductEventRepo,
  createProjectRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createProjectEventDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return {
    projects: createProjectRepo(prisma),
    events: createProductEventRepo(prisma),
  };
}
