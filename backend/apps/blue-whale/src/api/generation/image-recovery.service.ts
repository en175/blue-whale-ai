import { Injectable, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { GenerationWorkerService } from "@lib/shared/generation/generation-worker.service.js";
import { recoverDueImageJobs } from "@lib/shared/generation/image-recovery.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/** 图片生成进程内恢复扫描（对齐 instrumentation.ts 的 recoverDueImageJobs）。 */
@Injectable()
export class ImageRecoveryService implements OnModuleInit {

  constructor(private readonly worker: GenerationWorkerService) {}

  async onModuleInit(): Promise<void> {
    await this.recover();
  }

  @Interval(
    Number.parseInt(process.env.GENERATION_RECOVERY_INTERVAL_MS ?? "60000", 10),
  )
  async recover(): Promise<void> {
    try {
      await recoverDueImageJobs(this.worker.deps);
    } catch (error) {
      logger.error(
        `image recovery scan failed${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    }
  }
}
