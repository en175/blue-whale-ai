import { resolveAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createGenerationInboxRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createGenerationInboxDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  // IK7EU4：manifest 按 AGENT_RUNTIME_MODE 解析（与 agent-worker 同源）。
  return createGenerationInboxRepo(prisma, resolveAgentRuntimeManifest());
}
