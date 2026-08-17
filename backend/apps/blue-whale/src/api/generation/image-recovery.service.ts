import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { GenerationWorkerService } from "@lib/shared/generation/generation-worker.service.js";
import { recoverDueImageJobs } from "@lib/shared/generation/image-recovery.js";

/** 图片生成进程内恢复扫描（对齐 instrumentation.ts 的 recoverDueImageJobs）。 */
@Injectable()
export class ImageRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(ImageRecoveryService.name);

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
      this.logger.error(
        "image recovery scan failed",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
