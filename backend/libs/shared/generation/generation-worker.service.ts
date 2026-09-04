import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createWorkerRepo } from "@blue-whale/persistence";
import { createNewApiAudioProvider } from "@lib/shared/generation-runtime/index.js";
import { createLogger } from "@blue-whale/core/logging";
import {
  createNewApiClient,
  loadGenerationCostConfig,
  loadGenerationCredentialSecret,
  openGenerationCredential,
  quotaToFen,
} from "@blue-whale/core";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { createGenerationImageProvider } from "./worker/ark-image-provider.js";
import { createNewApiVideoProvider } from "./worker/new-api-video-provider.js";
import type { WorkerDeps } from "./worker/generation-worker.js";

/** IK9VZ0：图片消费流水查询短重试（防 new-api 落流水延迟竞态：出图响应先于流水落库）。
 *  查询抛错 / 查不到（null）/ 查到的 quota≤0 都重试，间隔 delayMs，最多 attempts 次；
 *  中途拿到 >0 的 quota 立即返回；全部失败返回最后一次结果（null 或 0），上层走取证失败告警落 0。
 *  缺省 500ms×3（设计文档领域 2.2）。 */
export async function retryConsumeQuotaLookup(
  lookup: (requestId: string) => Promise<number | null>,
  requestId: string,
  attempts = 3,
  delayMs = 500,
): Promise<number | null> {
  let last: number | null = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const quota = await lookup(requestId);
      if (quota !== null && quota > 0) return quota;
      last = quota;
    } catch {
      // 网络/上游异常 → 静默重试，最终失败由上层告警通道暴露
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return last;
}

/** 图片生成 worker 依赖装配（对齐 createGenerationWorkerDeps）：
 *  repo + image/video provider + 凭证库 + 媒体存储 + 成本换算。 */
@Injectable()
export class GenerationWorkerService {
  private readonly workerId = `image-recovery-${hostname()}-${process.pid}`;
  private depsInstance?: WorkerDeps;
  private readonly logger = createLogger("generation-worker");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AssetStorageService,
  ) {}

  get deps(): WorkerDeps {
    if (!this.depsInstance) {
      const credentialSecret = loadGenerationCredentialSecret();
      const baseUrl = process.env.NEW_API_BASE_URL ?? "";
      const costClient = baseUrl ? createNewApiClient({ baseUrl }) : null;
      const costConfig = loadGenerationCostConfig();
      this.depsInstance = {
        workerId: this.workerId,
        repo: createWorkerRepo(this.prisma.client),
        createImageProvider: (token: string) =>
          createGenerationImageProvider({ token }),
        createAudioProvider: (token: string) =>
          createNewApiAudioProvider({
            baseUrl: process.env.NEW_API_BASE_URL ?? "",
            token,
          }),
        credentialVault: {
          open: (ciphertext: string) =>
            openGenerationCredential(ciphertext, credentialSecret),
        },
        videoProvider: createNewApiVideoProvider({
          baseUrl: process.env.NEW_API_BASE_URL ?? "",
          token: "",
        }),
        mediaStorage: this.storage.uploads,
        ...(costClient
          ? {
              // IK9VZ0：流水查询短重试（500ms×3），消除"出图成功但流水未落库 → 整批落 0"竞态。
              readConsumeQuota: async (token: string, requestId: string) =>
                retryConsumeQuotaLookup(
                  (rid) =>
                    costClient
                      .getConsumeLogByRequestId(token, rid)
                      .then((log) => (log ? log.quota : null)),
                  requestId,
                ),
              quotaToFen: (quota: number) => quotaToFen(quota, costConfig),
            }
          : {}),
        // IK9VZ0：实扣取证失败告警通道（日志 + metric 打点，需求 2「日志+指标」）。
        warn: (message: string) => {
          this.logger.warn(`[cost] ${message}`);
          this.logger.metric({
            event: "cost_receipt_failed",
            result: "fail",
            fields: { job_type: "image" },
          });
        },
      };
    }
    return this.depsInstance;
  }
}
