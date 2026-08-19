import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createWorkerRepo } from "@blue-whale/persistence";
import { createLogger } from "@blue-whale/core/logging";
import {
  loadGenerationCostConfig,
  loadGenerationCredentialSecret,
  openGenerationCredential,
  quotaToFen,
} from "@blue-whale/core";
import {
  createNewApiVideoTaskProvider,
  createPassthroughVideoMediaRelay,
  createTosVideoMediaRelay,
  loadGenerationMediaRelayMode,
  loadGenerationTosConfig,
  runVideoJobStep,
} from "@blue-whale/generation-runtime";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { enqueueVideoGenerationJob } from "@lib/shared/generation/video-queue.js";

const logger = createLogger("generation-worker");

/** 视频 worker 依赖装配（对齐 workers/generation-worker.ts）：
 *  repo + new-api provider + 凭证库 + 媒体转存 + 成本换算，跑 runVideoJobStep 短步骤。 */
@Injectable()
export class VideoWorkerService {
  private readonly workerId = `generation-${hostname()}-${process.pid}`;
  private readonly baseUrl = process.env.NEW_API_BASE_URL ?? "";
  private readonly credentialSecret = loadGenerationCredentialSecret();
  private readonly costConfig = loadGenerationCostConfig();

  constructor(private readonly prisma: PrismaService) {}

  get repo() {
    return createWorkerRepo(this.prisma.client);
  }

  async runStep(jobId: string): Promise<string | null> {
    logger.debug(`runStep start jobId=${jobId}`);
    const mediaRelayMode = loadGenerationMediaRelayMode();
    const tosConfig =
      mediaRelayMode === "passthrough" ? null : loadGenerationTosConfig();
    if (mediaRelayMode === "tos" && !tosConfig) {
      throw new Error("TOS configuration required");
    }
    const mediaRelay =
      mediaRelayMode === "passthrough"
        ? createPassthroughVideoMediaRelay()
        : createTosVideoMediaRelay(tosConfig!);

    return runVideoJobStep({
      repo: this.repo,
      workerId: this.workerId,
      jobId,
      createProvider: (token) =>
        createNewApiVideoTaskProvider({ baseUrl: this.baseUrl, token }),
      credentialVault: {
        open: (ciphertext) =>
          openGenerationCredential(ciphertext, this.credentialSecret),
      },
      mediaRelay,
      scheduleNext: (id, delayMs) => enqueueVideoGenerationJob(id, { delayMs }),
      quotaToFen: (quota) => quotaToFen(quota, this.costConfig),
    });
  }
}
