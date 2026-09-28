/* ============================================
 * 价格预览（Quote）—— 生成前告诉用户「这次预计消耗多少积分」
 *
 * ⚠️ **只读**：不冻结、不写库、不改任何状态、不碰余额。所以它与预扣（Hold）的失败语义
 *    **相反**：Hold fail closed（扣不动就别开始干活），报价 fail open —— 算不出价
 *    （定价漏配 UNPRICEABLE / billing 不可用）就回 `credits: null`，前端不显示价格。
 *    **报价的失败绝不阻断任何操作**：这条路径一分钱都不动。
 *
 * ⚠️ **与预扣同源**：规格走建任务那一个 {@link projectQuoteInput}（内部就是 strategies
 *    的 composeInput），等级走同一个 `identity.resolveTier` —— 预览价必须等于实际会冻的钱。
 *    这两处任何一处分叉，用户就会看到「预览一个价、实扣另一个价」。
 * ============================================ */
import { RESOURCE_NOT_FOUND_CODE, fail, ok, type ResultEnvelope } from "@lib/contracts";
import type {
  ModelCapabilityRepo,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";

import type { BillingQuote } from "../billing/billing-quote.js";
import {
  projectQuoteInput,
  type CreateGenerationJobBody,
  type GenerationType,
  serializePricingRule,
} from "./handle-create-generation-job.js";

export interface QuoteGenerationJobDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  /** 能力目录白名单：报价要按**同一份**能力行冻结规格（如 features.audio ⇒ generate_audio）。 */
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  /** 报价函数（`billing-quote.ts` 装配：同一套规格归一 + 同一个 resolveTier）。 */
  quote: BillingQuote;
}

/** 价格预览的响应体：**只有一个整数积分**，或 null（无报价）。
 *
 *  ⚠️ 硬规则：任何用户可见界面**永远只出现一个金额**。折扣系数（discount_bp）、
 *    预扣明细这些一概不回 —— 用户看到的必须是最终的、他会被扣的那个数。 */
export interface QuoteGenerationJobData {
  credits: number | null;
}

/**
 * POST /api/projects/:projectId/generation-jobs/quote
 *
 * 入参与创建任务**同形**（同一个 parameters ⇒ 同一个 model / 同一份规格），否则预览与实扣会漂。
 *
 * 只有「项目不存在」是错误：模型不在白名单里、类型不支持、参数不全、报价算不出，一律回
 * `credits: null`（无报价）。理由 —— 那些情况创建时自会给出准确的拒绝文案，而预览不该抢在
 * 前面把一次「看看多少钱」的请求变成报错。
 */
export async function handleQuoteGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  deps: QuoteGenerationJobDeps,
): Promise<ResultEnvelope<QuoteGenerationJobData | null>> {
  // 项目归属（不泄漏存在性）——与建任务同一道，预览也不能跨项目看价。
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const type = body.type as GenerationType;
  const params = body.parameters as { model_id?: unknown } | undefined;
  const modelId =
    typeof params === "object" && params !== null && typeof params.model_id === "string"
      ? params.model_id
      : null;
  if (modelId === null) return ok({ credits: null });

  const whitelist = await deps.models.listEnabledByType(type);
  // 不在能力目录（未启用/已停用）的模型**不给报价**：那个组合本来就提交不了，
  // 报个价只会让用户以为能生成、点下去才知道 400。这里不报错（预览不该抢在建任务前面拒绝）。
  const capability = whitelist.find((m) => m.model_id === modelId);
  if (!capability) return ok({ credits: null });

  const input = projectQuoteInput(type, body, capability);
  if (input === null) return ok({ credits: null });

  // 规则快照与 Hold 同源：预览与实扣必须取到**同一份**规则，
  // 否则用户看到的是「预览一个价、实扣另一个价」。序列化在 `handle-create-generation-job`
  // 的同名助手处，两边共用一条实现（那一个函数导出于此）。
  const ruleSnapshot = serializePricingRule(capability);
  const quote = await deps.quote({
    userId,
    modelId,
    taskType: type,
    input,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  return ok({ credits: quote === null ? null : Number(quote.credits) });
}
