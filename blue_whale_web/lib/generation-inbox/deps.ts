import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createGenerationInboxRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createGenerationInboxDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return createGenerationInboxRepo(prisma, bundledAgentRuntimeManifest);
}
