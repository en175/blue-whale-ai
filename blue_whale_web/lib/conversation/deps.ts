import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createConversationRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createConversationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return createConversationRepo(prisma, bundledAgentRuntimeManifest);
}
