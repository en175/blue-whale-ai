import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createBillingCharge, type BillingCharge } from "@lib/shared/billing/billing-charge.js";
import {
  createBillingRelease,
  createOutboxTerminalEnqueue,
  type BillingRelease,
} from "@lib/shared/billing/billing-release.js";
import { createBillingQuote, type BillingQuote } from "@lib/shared/billing/billing-quote.js";
import { AccountDirectoryService } from "@lib/shared/identity/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { Body, Controller, Headers, HttpCode, Param, Post, Res } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { DomainError, ok } from "@lib/contracts";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import {
  handleCreateGenerationJob,
  type CreateGenerationJobBody,
} from "@lib/shared/generation/handle-create-generation-job.js";
import { handleQuoteGenerationJob } from "@lib/shared/generation/handle-quote-generation-job.js";
import {
  handleFinalizeGenerationJobCreate,
  handleFinalizeGenerationJobQuote,
} from "@lib/shared/generation/handle-finalize-generation-job.js";
import {
  handleRegenerateSampleCreate,
  handleRegenerateSampleQuote,
} from "@lib/shared/generation/handle-regenerate-sample-generation-job.js";
import { handleCancelGenerationJob } from "@lib/shared/generation/handle-cancel-generation-job.js";
import { handleRetryGenerationJob } from "@lib/shared/generation/handle-retry-generation-job.js";
import {
  enqueueAudioGenerationJob,
  enqueueImageGenerationJob,
  enqueueVideoGenerationJob,
} from "@lib/shared/generation/generation-queue.js";
import { createRequestMaterialGate } from "@lib/shared/generation/material-gate-wiring.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { enqueueFailureLog } from "@lib/infra/mq/rocketmq-producer.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import type { Response } from "express";
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

function bodyString(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

@Controller("projects/:projectId/generation-jobs")
export class GenerationJobsController {
  constructor(
    private readonly project: ProjectService,
    private readonly command: GenerationCommandService,
    private readonly models: ModelCapabilityReadService,
    private readonly canvas: CanvasService,
    private readonly material: MaterialService,
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
    private readonly directory: AccountDirectoryService,
    private readonly prisma: PrismaService,
  ) {}

  private billingDep?: { charge: BillingCharge; release: BillingRelease };

  private billing() {
    if (this.billingDep === undefined) {
      this.billingDep = {
        charge: createBillingCharge({
          client: sharedBillingClient(),
          resolveTier: (userId) => this.directory.resolveTier(userId),
          logger,
        }),
        release: createBillingRelease({
          enqueue: createOutboxTerminalEnqueue(this.prisma.client),
          logger,
        }),
      };
    }
    return this.billingDep;
  }

  private billingQuoteDep?: BillingQuote;

  private billingQuote(): BillingQuote {
    if (this.billingQuoteDep === undefined) {
      this.billingQuoteDep = createBillingQuote({
        client: sharedBillingClient(),
        resolveTier: (userId) => this.directory.resolveTier(userId),
        logger,
      });
    }
    return this.billingQuoteDep;
  }

  private buildMaterialGate(userId: string) {
    return createRequestMaterialGate({
      repo: this.material.materialStatusRepo,
      callAction: (action, body) => this.material.callAction(action, body),
      resolveLocalAssetMaterialIds: (userId, assetIds) =>
        this.assets.findBoundMaterialIds(userId, assetIds),
      onMaterialFailure: (input) =>
        this.handleMaterialFailure(userId, input.materialId, {
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          deleteUpstream: input.deleteUpstream,
        }),
    });
  }

  private async handleMaterialFailure(
    userId: string,
    materialId: string,
    opts: {
      errorCode?: string | null;
      errorMessage?: string | null;
      deleteUpstream?: boolean;
    },
  ): Promise<void> {
    try {
      await this.material.handleUpstreamMaterialFailure({
        userId,
        materialId,
        errorCode: opts.errorCode ?? null,
        errorMessage: opts.errorMessage ?? null,
        ...(opts.deleteUpstream === false ? { deleteUpstream: false } : {}),
      });
    } catch (error) {
      logger.warn(
        `[generation] 素材失败处置异常 materialId=${materialId}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  private async failEnqueue(jobId: string, userId: string): Promise<void> {
    const transitioned = await this.command
      .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
        raw: "RocketMQ 入队失败",
      })
      .catch(() => false);
    if (!transitioned) {
      return;
    }
    await this.billing().release({
      userId,
      jobId: Number(jobId),
      reason: "任务入队失败",
    });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateGenerationJobBody,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const billing = this.billing();
    const result = await handleCreateGenerationJob(
      user.userId,
      projectId,
      body,
      idempotencyKey ?? null,
      {
        projects: this.project,
        command: this.command.repo,
        models: this.models,
        canvas: this.canvas,
        assets: this.command.assets,
        ...(this.storage.probe ? { probe: this.storage.probe } : {}),
        materialGate: this.buildMaterialGate(user.userId),
        billing,
        quote: this.billingQuote(),
      },
    );

    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }

    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }

    if (result.code === 200 && result.data && body.type === "video") {
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueVideoGenerationJob(jobId);
      } catch (error) {
        const log = enqueueFailureLog(error, { scope: "generation", kind: "video", jobId });
        logger[log.level](log.message);
        if (log.level === "error") {
          await this.failEnqueue(jobId, user.userId);
        }
      }
    } else if (result.code === 200 && result.data && body.type === "image") {
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueImageGenerationJob(jobId);
      } catch (error) {
        const log = enqueueFailureLog(error, { scope: "generation", kind: "image", jobId });
        logger[log.level](log.message);
        if (log.level === "error") {
          await this.failEnqueue(jobId, user.userId);
        }
      }
    } else if (result.code === 200 && result.data && body.type === "audio") {
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueAudioGenerationJob(jobId);
      } catch (error) {
        const log = enqueueFailureLog(error, { scope: "generation", kind: "audio", jobId });
        logger[log.level](log.message);
        if (log.level === "error") {
          await this.failEnqueue(jobId, user.userId);
        }
      }
    }
    return result;
  }

  @Post("quote")
  @HttpCode(200)
  async quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateGenerationJobBody,
  ) {
    let quote: BillingQuote;
    try {
      quote = this.billingQuote();
    } catch (error) {
      logger.warn(
        `[generation] 报价不可用，本次不显示价格：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return ok({ credits: null, quote_revision: null });
    }
    return handleQuoteGenerationJob(user.userId, projectId, body, {
      projects: this.project,
      models: this.models,
      canvas: this.canvas,
      assets: this.command.assets,
      ...(this.storage.probe ? { probe: this.storage.probe } : {}),
      quote,
    });
  }

  @Post(":jobId/finalize/quote")
  @HttpCode(200)
  async finalizeQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
  ) {
    let quote: BillingQuote;
    try {
      quote = this.billingQuote();
    } catch (error) {
      logger.warn(
        `[generation] 成片报价不可用，本次不显示价格：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return ok({ credits: null, quote_revision: null });
    }
    return handleFinalizeGenerationJobQuote(user.userId, projectId, jobId, body, {
      projects: this.project,
      models: this.models,
      command: this.command.finalize,
      quote,
    });
  }

  @Post(":jobId/finalize")
  async finalize(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const billing = this.billing();
    const result = await handleFinalizeGenerationJobCreate(
      user.userId,
      projectId,
      jobId,
      body,
      idempotencyKey ?? null,
      {
        projects: this.project,
        models: this.models,
        command: this.command.finalize,
        billing,
        quote: this.billingQuote(),
      },
    );
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    if (result.data) {
      const finalizeJobId = String(result.data.generation_job_id);
      try {
        await enqueueVideoGenerationJob(finalizeJobId);
      } catch (error) {
        const log = enqueueFailureLog(error, {
          scope: "generation",
          kind: "finalize video",
          jobId: finalizeJobId,
        });
        logger[log.level](log.message);
        if (log.level === "error") {
          await this.failEnqueue(finalizeJobId, user.userId);
        }
      }
    }
    return result;
  }

  @Post(":jobId/regenerate-sample/quote")
  @HttpCode(200)
  async regenerateSampleQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
  ) {
    let quote: BillingQuote;
    try {
      quote = this.billingQuote();
    } catch (error) {
      logger.warn(
        `[generation] 重新生成样片报价不可用，本次不显示价格：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return ok({ credits: null, quote_revision: null });
    }
    return handleRegenerateSampleQuote(user.userId, projectId, jobId, body, {
      projects: this.project,
      models: this.models,
      canvas: this.canvas,
      assets: this.command.assets,
      ...(this.storage.probe ? { probe: this.storage.probe } : {}),
      sampleSource: this.command.finalize,
      quote,
    });
  }

  @Post(":jobId/regenerate-sample")
  async regenerateSample(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const billing = this.billing();
    const result = await handleRegenerateSampleCreate(
      user.userId,
      projectId,
      jobId,
      body,
      idempotencyKey ?? null,
      {
        projects: this.project,
        models: this.models,
        canvas: this.canvas,
        assets: this.command.assets,
        sampleSource: this.command.finalize,
        create: {
          projects: this.project,
          command: this.command.repo,
          models: this.models,
          canvas: this.canvas,
          assets: this.command.assets,
          ...(this.storage.probe ? { probe: this.storage.probe } : {}),
          materialGate: this.buildMaterialGate(user.userId),
          billing,
          quote: this.billingQuote(),
        },
      },
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    if (result.data) {
      const sampleJobId = String(result.data.generation_job_id);
      try {
        await enqueueVideoGenerationJob(sampleJobId);
      } catch (error) {
        const log = enqueueFailureLog(error, {
          scope: "generation",
          kind: "regenerate-sample video",
          jobId: sampleJobId,
        });
        logger[log.level](log.message);
        if (log.level === "error") {
          await this.failEnqueue(sampleJobId, user.userId);
        }
      }
    }
    return result;
  }

  @Post(":jobId/cancel")
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    const result = await handleCancelGenerationJob(user.userId, projectId, jobId, {
      projects: this.project,
      command: this.command.repo,
    });
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    return result;
  }

  @Post(":jobId/retry")
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const canvasBindingBody = typeof body === "object" && body !== null
      ? (body as { canvas_binding?: unknown }).canvas_binding
      : undefined;
    const billing = this.billing();
    const result = await handleRetryGenerationJob(
      user.userId,
      projectId,
      jobId,
      idempotencyKey ?? "",
      bodyString(body),
      {
        projects: this.project,
        command: this.command.repo,
        materialGate: this.buildMaterialGate(user.userId),
        billing,
      },
      canvasBindingBody,
    );
    if (isRecoveryControlledEnvelope(result)) {
      res?.status(result.code).json(result);
      return;
    }
    if (result.code === 200 && result.data) {
      const newJobId = String(result.data.generation_job_id);
      if (result.data.type === "video") {
        try {
          await enqueueVideoGenerationJob(newJobId);
        } catch (error) {
          const log = enqueueFailureLog(error, { scope: "generation", kind: "retry video", jobId: newJobId });
          logger[log.level](log.message);
          if (log.level === "error") {
            await this.failEnqueue(newJobId, user.userId);
          }
        }
      } else if (result.data.type === "image") {
        try {
          await enqueueImageGenerationJob(newJobId);
        } catch (error) {
          const log = enqueueFailureLog(error, { scope: "generation", kind: "retry image", jobId: newJobId });
          logger[log.level](log.message);
          if (log.level === "error") {
            await this.failEnqueue(newJobId, user.userId);
          }
        }
      } else if (result.data.type === "audio") {
        try {
          await enqueueAudioGenerationJob(newJobId);
        } catch (error) {
          const log = enqueueFailureLog(error, { scope: "generation", kind: "retry audio", jobId: newJobId });
          logger[log.level](log.message);
          if (log.level === "error") {
            await this.failEnqueue(newJobId, user.userId);
          }
        }
      }
    }
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    return result;
  }
}
