import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import { enqueueAudioMixJob } from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects/:projectId/audio-mixes")
export class AudioMixesController {
  constructor(private readonly audioMixes: AudioMixesService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
  ) {
    const result = await this.audioMixes.create(
      user.userId,
      projectId,
      body ?? {},
      sealProviderCredential(authorization),
    );
    if (!result.data) return result;
    const jobId = result.data.job_id;
    try {
      await enqueueAudioMixJob(jobId);
    } catch (error) {
      logger.error(`[audio_mix] enqueue failed jobId=${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.audioMixes.markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败");
    }
    return result;
  }
}
