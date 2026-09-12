// IKCR78：音频生成 MQ 消费者 worker 依赖装配。装配 repo + audio provider + 凭证库 +
// TOS mediaStorage + 成本换算，跑 processAudioJobById 单 job 长调用（audio 走 data 直传）。
// 镜像 image-worker.service（IKBGKA）——audio 与 image 同为单 asset 长调用路径。
import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createNewApiAudioProvider } from "@lib/shared/generation-runtime/index.js";
import { createLogger } from "@blue-whale/core/logging";
import {
  createNewApiClient,
  loadGenerationCostConfig,
  quotaToFen,
} from "@blue-whale/core";
import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  createTosStorage,
  loadTosStorageConfig,
} from "@lib/shared/assets/tos-storage.js";
import {
  processAudioJobById,
  type WorkerDeps,
} from "@lib/shared/generation/worker/generation-worker.js";
import { createGenerationImageProvider } from "@lib/shared/generation/worker/ark-image-provider.js";
import { retryConsumeQuotaLookup } from "@lib/shared/generation/generation-worker.service.js";

const logger = createLogger("generation-worker");

@Injectable()
export class AudioWorkerService {
  private readonly workerId = `audio-${hostname()}-${process.pid}`;
  private depsInstance?: WorkerDeps;
  private readonly log = createLogger("generation-worker");

  constructor(private readonly prisma: PrismaService) {}

  get deps(): WorkerDeps {
    if (!this.depsInstance) {
      const baseUrl = process.env.NEW_API_BASE_URL ?? "";
      const costClient = baseUrl ? createNewApiClient({ baseUrl }) : null;
      const costConfig = loadGenerationCostConfig();
      const tosConfig = loadTosStorageConfig();
      this.depsInstance = {
        workerId: this.workerId,
        repo: createWorkerRepo(this.prisma.client),
        // WorkerDeps 的 createImageProvider 为必填；音频路径不会命中图片分支，但保持装配完整。
        createImageProvider: (token: string) =>
          createGenerationImageProvider({ token }),
        createAudioProvider: (token: string) =>
          createNewApiAudioProvider({ baseUrl: baseUrl, token }),
        credentialVault: {
          open: (ciphertext: string) => ciphertext,
        },
        mediaStorage: tosConfig ? createTosStorage(tosConfig).uploads : null,
        ...(costClient
          ? {
              // IK9VZ0：流水查询短重试（500ms×3），消除"生成成功但流水未落库 → actual 落 0"竞态。
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
        warn: (message: string) => {
          this.log.warn(`[cost] ${message}`);
          this.log.metric({
            event: "cost_receipt_failed",
            result: "fail",
            fields: { job_type: "audio" },
          });
        },
      };
    }
    return this.depsInstance;
  }

  /** MQ 消费端单消息入口：claim 到即处理单音频 job。 */
  async runStep(jobId: string): Promise<string | null> {
    return processAudioJobById(jobId, this.deps);
  }
}
