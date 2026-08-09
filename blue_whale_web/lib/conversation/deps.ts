import { resolveAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createAgentRunRepo,
  createCanvasRepo,
  createConversationRepo,
  createPlanApplicationRepo,
  createSceneCardGenerationRepo,
  createSceneCardResourceRepo,
  createStoryboardPreviewRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createConversationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  // IK7EU4：manifest 按 AGENT_RUNTIME_MODE 解析（与 agent-worker 同源），
  // 保证 RunPin 的 model_profile 与 worker 装配的适配器一致；默认 fake 不变。
  return createConversationRepo(prisma, resolveAgentRuntimeManifest());
}

export function createAgentRunCommandDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createAgentRunRepo(getPrismaClient(databaseUrl));
}

export function createPlanApplicationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createPlanApplicationRepo(getPrismaClient(databaseUrl));
}

export function createSceneCardGenerationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createSceneCardGenerationRepo(getPrismaClient(databaseUrl));
}

export function createSceneCardResourceDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createSceneCardResourceRepo(getPrismaClient(databaseUrl));
}

export function createStoryboardPreviewDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createStoryboardPreviewRepo(getPrismaClient(databaseUrl));
}

export function createCanvasDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createCanvasRepo(getPrismaClient(databaseUrl));
}
