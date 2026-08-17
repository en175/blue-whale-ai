import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";
import { createWorkerRepo } from "@blue-whale/persistence";
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

/** 图片生成 worker 依赖装配（对齐 createGenerationWorkerDeps）：
 *  repo + image/video provider + 凭证库 + 媒体存储 + 成本换算。 */
@Injectable()
export class GenerationWorkerService {
  private readonly workerId = `image-recovery-${hostname()}-${process.pid}`;
  private depsInstance?: WorkerDeps;

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
    return this.depsInstance;
  }
}
