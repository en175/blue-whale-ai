import {
  createGenerationCommandRepo,
  createModelCapabilityRepo,
  createProjectRepo,
  createWorkerRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

import { createGenerationImageProvider } from "./worker/ark-image-provider";
import { createNewApiVideoProvider } from "./worker/new-api-video-provider";
import { createTosStorage, loadTosStorageConfig } from "../assets/tos-storage";

/** Generation 用例依赖：wire Prisma model capability repo。 */
export function createGenerationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { models: createModelCapabilityRepo(getPrismaClient(databaseUrl)) };
}

/** Generation 命令依赖（create/cancel/retry）：wire project repo（验归属）+ command repo。 */
export function createGenerationCommandDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const db = getPrismaClient(databaseUrl);
  return {
    projects: createProjectRepo(db),
    command: createGenerationCommandRepo(db),
  };
}

/** Worker 依赖（认领 queued 任务 → 出图 → 结任务）。create 接口异步触发，单 Next.js 进程内跑。 */
export function createGenerationWorkerDeps(newApiToken?: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const tosConfig = loadTosStorageConfig();
  return {
    repo: createWorkerRepo(getPrismaClient(databaseUrl)),
    provider: createGenerationImageProvider({ token: newApiToken }),
    videoProvider: createNewApiVideoProvider({
      baseUrl: process.env.NEW_API_BASE_URL ?? "",
      token: newApiToken ?? "",
    }),
    mediaStorage: tosConfig ? createTosStorage(tosConfig).uploads : null,
  };
}
