import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createAgentRunRepo,
  createConversationRepo,
  createPlanApplicationRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createConversationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return createConversationRepo(prisma, bundledAgentRuntimeManifest);
}

export function createAgentRunCommandDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createAgentRunRepo(getPrismaClient(databaseUrl));
}

/** PlanMessage 手动应用依赖：applyPlanMessage repo + 余额预检回调（调用方闭包 sk token）。 */
export function createPlanApplicationDeps(deps: {
  quotaCheck: () => Promise<{ sufficient: boolean }>;
}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return {
    applyPlanMessage: createPlanApplicationRepo(prisma).applyPlanMessage,
    quotaCheck: deps.quotaCheck,
  };
}
