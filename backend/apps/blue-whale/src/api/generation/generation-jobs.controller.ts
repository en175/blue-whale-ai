import { billingEndpoint, createBillingClient, enforceHold } from "@lib/shared/billing/billing-client.js";
import { createBillingHold } from "@lib/shared/billing/billing-hold.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { Body, Controller, Headers, Param, Post } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { DomainError } from "@lib/contracts";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import {
  handleCreateGenerationJob,
  type CreateGenerationJobBody,
} from "@lib/shared/generation/handle-create-generation-job.js";
import { handleCancelGenerationJob } from "@lib/shared/generation/handle-cancel-generation-job.js";
import { handleRetryGenerationJob } from "@lib/shared/generation/handle-retry-generation-job.js";
import {
  enqueueAudioGenerationJob,
  enqueueImageGenerationJob,
  enqueueVideoGenerationJob,
} from "@lib/shared/generation/generation-queue.js";
import { sealProviderCredential } from "@lib/shared/generation/credential.js";
import { createRequestMaterialGate } from "@lib/shared/generation/material-gate-wiring.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { ERROR_ENQUEUE_FAILED } from "@lib/contracts";
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
    private readonly canvas: CanvasService,
    private readonly material: MaterialService,
    private readonly assets: AssetService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * 预扣依赖（懒建一次）。
   *
   * <p>两种情况下**不接线**：`BILLING_GRPC_URL` 未配置、或 `BILLING_ENFORCE_HOLD` 未开。
   * 后者是默认 —— 切换前 billing 一旦真扣，new-api 那边还在扣，用户会被扣两遍
   * （《迁移与切换 runbook》§3.1）。等断 sk- 链的同一个发布窗口再打开。
   */
  private billingHoldDep?: ReturnType<typeof createBillingHold> | null;

  private billingHold() {
    if (this.billingHoldDep === undefined) {
      const endpoint = billingEndpoint();
      this.billingHoldDep =
        endpoint && enforceHold()
          ? createBillingHold({
              client: createBillingClient(endpoint),
              resolveTier: (userId) => this.identity.resolveTier(userId),
              enforce: true,
              logger,
            })
          : null;
    }
    return this.billingHoldDep ?? undefined;
  }

  /** IKF YHJ：造素材校验状态门（ADR-0087）。生产判定逻辑在 `material-gate-wiring.ts`，
   *  这里只把本请求的依赖（用户、凭证、仓库面、失败处置）接上去——抽出去是为了可测：
   *  它曾是控制器里的私有方法，整条生产判定路径零测试覆盖。 */
  private buildMaterialGate(userId: string, authorization: string | undefined) {
    return createRequestMaterialGate({
      repo: this.material.materialStatusRepo,
      callAction: (action, body) =>
        this.material.callAction(authorization, action, body),
      resolveLocalAssetMaterialIds: (userId, assetIds) =>
        this.assets.findBoundMaterialIds(userId, assetIds),
      onMaterialFailure: (input) =>
        this.handleMaterialFailure(userId, input.materialId, {
          authorization,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          deleteUpstream: input.deleteUpstream,
        }),
    });
  }

  /** IKF YHJ：素材被判失败时的统一处置（见 `MaterialService.handleUpstreamMaterialFailure`）。
   *  **永不抛**——它跑在 `fetchUpstreamStatus` 的 try 里，抛了会被咽成「本轮未知」，
   *  把本该是终局拒绝的结果降级成「请稍后重试」，正好把这次的修复抵消掉。 */
  private async handleMaterialFailure(
    userId: string,
    materialId: string,
    opts: {
      authorization: string | undefined;
      errorCode?: string | null;
      errorMessage?: string | null;
      deleteUpstream?: boolean;
    },
  ): Promise<void> {
    try {
      await this.material.handleUpstreamMaterialFailure({
        userId,
        materialId,
        authorization: opts.authorization,
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

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: CreateGenerationJobBody,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("authorization") authorization?: string,
  ) {
    const internal = sealProviderCredential(authorization);
    const holdDep = this.billingHold();
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
        materialGate: this.buildMaterialGate(user.userId, authorization),
        ...(this.cost.estimator ? { costEstimator: this.cost.estimator } : {}),
        // ⚠️ 先取到局部变量再条件展开：exactOptionalPropertyTypes 下
        //    直接写 `...(f() ? { k: f() } : {})` 会得到 `k: T | undefined`，不被接受
        ...(holdDep ? { billingHold: holdDep } : {}),
      },
      internal,
    );

    // IKG57P：拒单信封与 HTTP 状态行一致。fail() 信封被 TransformInterceptor 透传时无人写
    // 状态码，Nest 按 @Post 默认回 201，只看状态码的客户端会把拒绝当成受理成功（ADR-0083）。
    // 抛 DomainError 走 AllExceptionsFilter 统一投影——code、msg、状态同出一张码表
    // （httpStatusForCode：4xx/5xx 原样，业务码查表，查不到 400）。只修本 POST 端点，
    // 全局信封→状态映射不在本单范围。
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }

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
    } else if (result.code === 200 && result.data && body.type === "audio") {
      // IKCR78：音频 job 走 RocketMQ（与图片同构；封死 API 进程内同步 processJob 后门）。
      // enqueue 抛异常 → markFailed 置 failed（fail-fast，用户可见失败）；
      // 与 media-extract（IKARDY）同款兜底，防入队失败后无消费端而静默悬挂。
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueAudioGenerationJob(jobId);
      } catch (error) {
        logger.error(
          `[generation] enqueue audio job failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        await this.command
          .markFailed(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
            raw: "RocketMQ 入队失败",
          })
          .catch(() => {});
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
    @Headers("authorization") authorization?: string,
  ) {
    const result = await handleRetryGenerationJob(
      user.userId,
      projectId,
      jobId,
      idempotencyKey ?? "",
      bodyString(body),
      {
        projects: this.project,
        command: this.command.repo,
        materialGate: this.buildMaterialGate(user.userId, authorization),
      },
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
      } else if (result.data.type === "audio") {
        // IKCR78：音频 retry 走 RocketMQ（与 image 同构；enqueue 失败 fail-fast 置 failed）。
        try {
          await enqueueAudioGenerationJob(newJobId);
        } catch (error) {
          logger.error(
            `[generation] enqueue retry audio job failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
          await this.command
            .markFailed(newJobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
              raw: "RocketMQ 入队失败",
            })
            .catch(() => {});
        }
      }
    }
    return result;
  }
}
