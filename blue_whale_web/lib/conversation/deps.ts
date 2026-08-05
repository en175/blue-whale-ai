import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import {
  createAgentRunRepo,
  createCanvasRepo,
  createConversationRepo,
  createPlanApplicationRepo,
  createSceneCardGenerationRepo,
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

export function createCanvasDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createCanvasRepo(getPrismaClient(databaseUrl));
}
