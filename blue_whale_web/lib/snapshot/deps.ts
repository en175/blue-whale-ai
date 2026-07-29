import {
  createCanvasRepo,
  createProjectRepo,
  createSnapshotRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

/** Snapshot 用例依赖：wire Prisma project + canvas + snapshot repo。 */
export function createSnapshotDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return {
    projects: createProjectRepo(prisma),
    canvas: createCanvasRepo(prisma),
    snapshot: createSnapshotRepo(prisma),
  };
}
