// IKBGKA：图片生成 MQ 消费者 worker 依赖装配。装配 repo + image/audio provider + 凭证库 +
// TOS mediaStorage（prepareUpload/makePublic，图片落地）+ 成本换算，跑 processImageJobById 单 job 长调用。
import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createNewApiAudioProvider } from "@lib/shared/generation-runtime/index.js";
import { createLogger } from "@blue-whale/core/logging";
import {
  createNewApiClient,
  loadGenerationCostConfig,
  loadGenerationCredentialSecret,
  openGenerationCredential,
  quotaToFen,
} from "@blue-whale/core";
import { createWorkerRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  createTosStorage,
  loadTosStorageConfig,
} from "@lib/shared/assets/tos-storage.js";
import {
  processImageJobById,
  type WorkerDeps,
} from "@lib/shared/generation/worker/generation-worker.js";
import { createGenerationImageProvider } from "@lib/shared/generation/worker/ark-image-provider.js";
import { retryConsumeQuotaLookup } from "@lib/shared/generation/generation-worker.service.js";

const logger = createLogger("generation-worker");

@Injectable()
export class ImageWorkerService {
  private readonly workerId = `image-${hostname()}-${process.pid}`;
  private depsInstance?: WorkerDeps;
  private readonly log = createLogger("generation-worker");

  constructor(private readonly prisma: PrismaService) {}

  get deps(): WorkerDeps {
    if (!this.depsInstance) {
      const credentialSecret = loadGenerationCredentialSecret();
      const baseUrl = process.env.NEW_API_BASE_URL ?? "";
      const costClient = baseUrl ? createNewApiClient({ baseUrl }) : null;
      const costConfig = loadGenerationCostConfig();
      const tosConfig = loadTosStorageConfig();
      this.depsInstance = {
        workerId: this.workerId,
        repo: createWorkerRepo(this.prisma.client),
        createImageProvider: (token: string) =>
          createGenerationImageProvider({ token }),
        createAudioProvider: (token: string) =>
          createNewApiAudioProvider({ baseUrl: baseUrl, token }),
        credentialVault: {
          open: (ciphertext: string) =>
            openGenerationCredential(ciphertext, credentialSecret),
        },
        mediaStorage: tosConfig ? createTosStorage(tosConfig).uploads : null,
        ...(costClient
          ? {
              // IK9VZ0：流水查询短重试（500ms×3），消除"出图成功但流水未落库 → actual 落 0"竞态。
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
        // IK9VZ0：实扣取证失败告警通道（日志 + metric 打点）。
        warn: (message: string) => {
          this.log.warn(`[cost] ${message}`);
          this.log.metric({
            event: "cost_receipt_failed",
            result: "fail",
            fields: { job_type: "image" },
          });
        },
      };
    }
    return this.depsInstance;
  }

  /** MQ 消费端单消息入口：claim 到即处理单图片 job。 */
  async runStep(jobId: string): Promise<string | null> {
    return processImageJobById(jobId, this.deps);
  }
}
