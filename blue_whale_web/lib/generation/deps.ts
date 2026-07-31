import {
  createGenerationCommandRepo,
  createModelCapabilityRepo,
  createProjectRepo,
  createWorkerRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

import {
  loadGenerationCredentialSecret,
  openGenerationCredential,
} from "@blue-whale/core";
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

/** Worker 依赖（认领 queued 任务 → 出图 → 结任务）。
 *  图片 sk token 不再来自请求闭包：create 时密封进 job.input.provider_credential，
 *  处理时由 credentialVault 解出 → createImageProvider。请求内即时调度与进程重启后的
 *  恢复扫描因此共用同一套逻辑（与 video 一致）。 */
export function createGenerationWorkerDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const tosConfig = loadTosStorageConfig();
  const credentialSecret = loadGenerationCredentialSecret();
  return {
    repo: createWorkerRepo(getPrismaClient(databaseUrl)),
    createImageProvider: (token: string) =>
      createGenerationImageProvider({ token }),
    credentialVault: {
      open: (ciphertext: string) =>
        openGenerationCredential(ciphertext, credentialSecret),
    },
    // 视频走 BullMQ 独立 worker（workers/generation-worker.ts），进程内 videoProvider 仅留作
    // 兼容；实际不被调度，token 留空。
    videoProvider: createNewApiVideoProvider({
      baseUrl: process.env.NEW_API_BASE_URL ?? "",
      token: "",
    }),
    mediaStorage: tosConfig ? createTosStorage(tosConfig).uploads : null,
  };
}
