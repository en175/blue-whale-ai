import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createBillingHold, type BillingHold } from "@lib/shared/billing/billing-hold.js";
import {
  createBillingRelease,
  publishBillingJobFailed,
  type BillingRelease,
} from "@lib/shared/billing/billing-release.js";
import { createBillingQuote, type BillingQuote } from "@lib/shared/billing/billing-quote.js";
import { IdentityService } from "@lib/shared/identity/index.js";
import { Body, Controller, Headers, HttpCode, Param, Post } from "@nestjs/common";
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
import { enqueueFailureLog } from "@lib/infra/mq/rocketmq-producer.js";
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
    private readonly canvas: CanvasService,
    private readonly material: MaterialService,
    private readonly assets: AssetService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * 预扣 + 失败补偿（懒建一次）。
   *
   * <p>⚠️ **必接，没有「不接线」的分支**。曾经有两种情况会跳过接线：`BILLING_GRPC_URL`
   * 未配置、或 `BILLING_ENFORCE_HOLD` 未开——那都是 new-api 还在替我们扣钱时期的产物。
   * new-api 已被切断，跳过接线就等于**白送一次生成**，而且没有任何报错。
   *
   * <p>地址缺失由 {@link sharedBillingClient} 内的 `billingEndpoint` 当场抛
   * （并已在启动期拦过一道），所以这里不需要判空。
   *
   * <p>release 与 hold **成对**（见 {@link createBillingRelease}）：预扣成功之后事务才失败时，
   * 只有它能把那笔冻结退掉，否则会留下一笔没有对应任务的预留。
   */
  private billingDep?: { hold: BillingHold; release: BillingRelease };

  private billing() {
    if (this.billingDep === undefined) {
      this.billingDep = {
        hold: createBillingHold({
          client: sharedBillingClient(),
          resolveTier: (userId) => this.identity.resolveTier(userId),
          logger,
        }),
        release: createBillingRelease({
          publish: publishBillingJobFailed,
          logger,
        }),
      };
    }
    return this.billingDep;
  }

  /**
   * 报价依赖（懒建一次）。与 {@link billing} 同一个客户端、同一个 `resolveTier`
   * —— 预览价与实扣价必须出自同一套规格归一与同一个等级解析。
   *
   * <p>与预扣不同的一点：这里**允许降级**。`sharedBillingClient()` 在地址缺失时会抛，
   * 而报价不该因此把「看看多少钱」变成一个 500 —— 见 {@link quote} 的 catch。
   */
  private billingQuoteDep?: BillingQuote;

  private billingQuote(): BillingQuote {
    if (this.billingQuoteDep === undefined) {
      this.billingQuoteDep = createBillingQuote({
        client: sharedBillingClient(),
        resolveTier: (userId) => this.identity.resolveTier(userId),
        logger,
      });
    }
    return this.billingQuoteDep;
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
    const billing = this.billing();
    // 建任务幂等：`result.data` 也可能是**幂等重放**的首次结果（同一个 generation_job_id）。
    // 这条路径下面照旧把它入队一次，是**刻意**的：
    //   · 对已领走/已终态的任务，worker 侧 claim 是 CAS 的（候选要求 queued，或 processing
    //     且租约过期），落不进去就是一次干净的 no-op，不会重复执行；
    //   · RocketMQ 本身是 at-least-once，消费端**本来就必须**容忍同一 job 的重复消息；
    //   · 反过来，第一次「建行成功但入队失败/进程崩了」的任务正靠这次重放捞回来
    //     （否则它只能等恢复扫描）。
    // 所以这里不按「是不是重放」分流。
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
        // 预扣与补偿必然成对（见 billing 的说明），不再做条件展开
        billing,
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
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueVideoGenerationJob(jobId);
      } catch (error) {
        // IKJ80Q：缺配≠故障（恢复扫描兜底）降 WARN，真失败 ERROR——分级与文案收口在 enqueueFailureLog。
        const log = enqueueFailureLog(error, { scope: "generation", kind: "video", jobId });
        logger[log.level](log.message);
      }
    } else if (result.code === 200 && result.data && body.type === "image") {
      // IKBGKA：图片 job 走 RocketMQ（消费端 Semaphore 控并发，不再 API 进程内无上限 fire-and-forget）。
      const jobId = String(result.data.generation_job_id);
      try {
        await enqueueImageGenerationJob(jobId);
      } catch (error) {
        // IKJ80Q：缺配≠故障，恢复扫描兜底（同 video 分支）。
        const log = enqueueFailureLog(error, { scope: "generation", kind: "image", jobId });
        logger[log.level](log.message);
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

  /** POST /api/projects/:projectId/generation-jobs/quote
   *  价格预览（只读）：算得出回一个整数积分，算不出回 `credits: null`（前端不显示价格）。
   *  **不冻结、不写库、不阻断任何操作**。
   *
   *  <p>入参与创建任务同形 —— 同一个 `parameters` 走建任务那一个规格投影，否则预览与实扣会漂。
   *
   *  <p>用 POST 而不是 GET：定价规格是一整个生成参数对象，塞查询串会与创建入参分叉（那正是
   *  要避免的漂移）。@HttpCode(200) 明确压掉 Nest 对 POST 的默认 201 —— 这次什么都没创建，
   *  「已受理」的状态行会让只看状态码的客户端误读。 */
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
      // 计费地址缺失（未接线的本地/测试环境）。这与预扣**刻意不同**：预扣缺配置必须硬失败
      // （否则是一条静默的免费通道），而这里只是「这次没显示价格」——一分钱不动，
      // 不该把一次看价请求变成 500，更不该挡住用户点生成。
      logger.warn(
        `[generation] 报价不可用，本次不显示价格：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return ok({ credits: null });
    }
    return handleQuoteGenerationJob(user.userId, projectId, body, {
      projects: this.project,
      models: this.models,
      quote,
    });
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
    // IKIPWT：与 create（IKG57P）同款口径——业务失败走 AllExceptionsFilter 统一投影，
    // 不让 fail() 信封透传成 HTTP 201。
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
          // IKJ80Q：缺配≠故障，恢复扫描兜底（同 create video 分支）。
          const log = enqueueFailureLog(error, { scope: "generation", kind: "retry video", jobId: newJobId });
          logger[log.level](log.message);
        }
      } else if (result.data.type === "image") {
        // IKBGKA：图片 retry 走 RocketMQ。
        try {
          await enqueueImageGenerationJob(newJobId);
        } catch (error) {
          // IKJ80Q：缺配≠故障，恢复扫描兜底（同 create video 分支）。
          const log = enqueueFailureLog(error, { scope: "generation", kind: "retry image", jobId: newJobId });
          logger[log.level](log.message);
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
    // IKIPWT：与 create（IKG57P）同款口径——业务失败走 AllExceptionsFilter 统一投影，
    // 不让 fail() 信封透传成 HTTP 201。
    if (result.code !== 200) {
      throw new DomainError(result.code, result.msg ?? undefined);
    }
    return result;
  }
}
