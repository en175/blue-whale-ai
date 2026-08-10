import { hostname } from "node:os";

import {
  createGenerationCommandRepo,
  createModelCapabilityRepo,
  createProjectRepo,
  createWorkerRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

import {
  loadGenerationCredentialSecret,
  loadGenerationCostConfig,
  openGenerationCredential,
  quotaToFen,
} from "@blue-whale/core";
import { createGenerationImageProvider } from "./worker/ark-image-provider";
import { createNewApiVideoProvider } from "./worker/new-api-video-provider";
import { createTosStorage, loadTosStorageConfig } from "../assets/tos-storage";
import { createWebNewApiClient } from "../logging";
import { createGenerationCostEstimator } from "./cost-estimator";

/** Generation 用例依赖：wire Prisma model capability repo。 */
export function createGenerationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { models: createModelCapabilityRepo(getPrismaClient(databaseUrl)) };
}

/** Generation 命令依赖（create/cancel/retry）：wire project repo（验归属）+ command repo + 能力白名单。 */
export function createGenerationCommandDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const db = getPrismaClient(databaseUrl);
  const baseUrl = process.env.NEW_API_BASE_URL ?? "";
  // IK7G9X：成本估算器。NEW_API_BASE_URL 未配置时 getPricing 无法调用，
  // estimator 捕获异常返回 null → 建预留降级记 0（不阻塞建任务）。
  const costEstimator = baseUrl
    ? createGenerationCostEstimator(createWebNewApiClient({ baseUrl }))
    : undefined;
  return {
    projects: createProjectRepo(db),
    command: createGenerationCommandRepo(db),
    models: createModelCapabilityRepo(db),
    ...(costEstimator ? { costEstimator } : {}),
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
  const baseUrl = process.env.NEW_API_BASE_URL ?? "";
  // IK7G9X：图片实扣金额 = 消费流水(request_id) quota → 分(fen)。NEW_API_BASE_URL 未配置则缺省。
  const costClient = baseUrl ? createWebNewApiClient({ baseUrl }) : null;
  const costConfig = loadGenerationCostConfig();
  return {
    // 进程内恢复扫描（instrumentation.ts）直接用这份 deps，必须自带 workerId，
    // 否则 claimNextImageJob(undefined) → lease_owner 落 NULL，租约归属混乱、恢复不稳。
    // 命名参照独立 worker（workers/generation-worker.ts:39 generation-${hostname}-${pid}），
    // 用 image-recovery- 前缀区分进程内恢复扫描与 BullMQ worker 的租约归属。
    workerId: `image-recovery-${hostname()}-${process.pid}`,
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
    ...(costClient
      ? {
          readConsumeQuota: async (token: string, requestId: string) => {
            const log = await costClient.getConsumeLogByRequestId(
              token,
              requestId,
            );
            return log ? log.quota : null;
          },
          quotaToFen: (quota: number) => quotaToFen(quota, costConfig),
        }
      : {}),
  };
}
