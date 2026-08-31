import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import { GenerationWorkerService } from "@lib/shared/generation/generation-worker.service.js";
import {
  handleCreateGenerationJob,
  type CreateGenerationJobBody,
} from "@lib/shared/generation/handle-create-generation-job.js";
import { handleCancelGenerationJob } from "@lib/shared/generation/handle-cancel-generation-job.js";
import { handleRetryGenerationJob } from "@lib/shared/generation/handle-retry-generation-job.js";
import {
  enqueueVideoGenerationJob,
  enqueueImageGenerationJob,
} from "@lib/shared/generation/video-queue.js";
import { processJob } from "@lib/shared/generation/worker/generation-worker.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/generation-jobs")
export class GenerationJobsController {
  constructor(
    private readonly project: ProjectService,
    private readonly command: GenerationCommandService,
    private readonly models: ModelCapabilityReadService,
    private readonly cost: GenerationCostEstimatorService,
    private readonly worker: GenerationWorkerService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateGenerationJobBody,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("authorization") authorization?: string,
  ) {
    const internal = sealProviderCredential(authorization);
    const result = await handleCreateGenerationJob(
      user.userId,
      projectId,
      body,
      idempotencyKey ?? null,
      {
        projects: this.project,
        command: this.command.repo,
        models: this.models,
        ...(this.cost.estimator ? { costEstimator: this.cost.estimator } : {}),
      },
      internal,
    );

    if (result.code === 200 && result.data && body.type === "video") {
      try {
        await enqueueVideoGenerationJob(String(result.data.generation_job_id));
      } catch (error) {
        logger.error(
          `[generation] enqueue video job failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    } else if (result.code === 200 && result.data && body.type === "image") {
      // IKBGKA：图片 job 走 RocketMQ（消费端 Semaphore 控并发，不再 API 进程内无上限 fire-and-forget）。
      try {
        await enqueueImageGenerationJob(String(result.data.generation_job_id));
      } catch (error) {
        logger.error(
          `[generation] enqueue image job failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    } else if (result.code === 200 && result.data) {
      void processJob({
        ...this.worker.deps,
        workerId: `next-${Date.now()}`,
        jobId: result.data.generation_job_id,
        userId: user.userId,
      }).catch((e) =>
        logger.error(
          `[generation] async worker failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
    return result;
  }

  @Post(":jobId/cancel")
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    return handleCancelGenerationJob(user.userId, projectId, jobId, {
      projects: this.project,
      command: this.command.repo,
    });
  }

  @Post(":jobId/retry")
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const result = await handleRetryGenerationJob(
      user.userId,
      projectId,
      jobId,
      idempotencyKey ?? "",
      bodyString(body),
      { projects: this.project, command: this.command.repo },
    );
    if (result.code === 200 && result.data) {
      const newJobId = String(result.data.generation_job_id);
      if (result.data.type === "video") {
        try {
          await enqueueVideoGenerationJob(newJobId);
        } catch (error) {
          logger.error(
            `[generation] enqueue retry video job failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      } else if (result.data.type === "image") {
        // IKBGKA：图片 retry 走 RocketMQ。
        try {
          await enqueueImageGenerationJob(newJobId);
        } catch (error) {
          logger.error(
            `[generation] enqueue retry image job failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      } else {
        void processJob({
          ...this.worker.deps,
          workerId: `next-retry-${Date.now()}`,
          jobId: result.data.generation_job_id,
          userId: user.userId,
        }).catch((e) =>
          logger.error(
            `[generation] async retry worker failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    }
    return result;
  }
}
