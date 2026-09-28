/* ============================================
 * 报价（Quote）的装配 —— 生成前的价格
 *
 * ⚠️ **与 Hold 同源**：同一份规格归一（billing-specs.ts）、同一个等级解析
 *    （resolveTier）、同一份定价目录。预览价必须等于实际会冻的钱 ——
 *    Hold 传 pro 而 Quote 传 free，用户就会看到「预览 100、实扣 70」，
 *    而那是会被当成「扣错了」的一类不一致。
 *
 * ⚠️ **报价不校验余额**（契约写明）：报价回答的是「这个组合多少钱」，
 *    与用户有多少钱无关。余额够不够是 Hold 的职责，不要在这里顺手加检查 ——
 *    加了就变成「没钱就不显示价」，与契约行为相反。
 *
 * ⚠️ **失败不阻断**：报价算不出来只是「这次没有估算」，不是提交失败。
 *    这里**吞掉异常返回 null** 是刻意的（与 Hold 的 fail closed 相反），
 *    因为这条路径**一分钱都不动**。调用方的既有行为是降级记 0 + 版本 "dev"。
 * ============================================ */
import type { BillingClient, BillingQuoteResult } from './billing-client.js';
import { extractSpecs } from './billing-specs.js';

/** 报价需要的上下文（与 {@link BillingHoldContext} 同形，只少 jobId/commandId ——
 *  报价不写任何东西，不需要幂等键）。 */
export interface BillingQuoteContext {
  userId: string;
  modelId: string;
  taskType: string;
  input: Record<string, unknown>;
  /**
   * 能力行的 `pricing` 快照（JSON 文本）。
   *
   * ⚠️ **必填** —— 缺省/空串 = billing 算不出价，回 `UNPRICEABLE`。
   * 这里**没有**「回落去查定价目录」那条路（目录早已不装模型规则，它只剩换算率与折扣策略）。
   *
   * 与预扣的差别只在**调用方怎么处置**：预扣 fail closed（拒绝提交），
   * 报价这条把异常吞掉返回 `null`（前端据此不显示预估）—— 它一分钱都不动，所以可以软失败。
   * 但两条路必须传**同一份**规则，否则「预览一个价、实扣另一个价」。
   */
  ruleSnapshot?: string;
}

export interface BillingQuoteDeps {
  client: BillingClient;
  /** 用户等级（identity 域）。取不到时返回 free —— 与 Hold 同一处置：
   *  保守方向，不打折，不会因为「取不到等级」就多让利。 */
  resolveTier: (userId: string) => Promise<string>;
  logger?: { warn: (message: string) => void };
}

/** 报价结果（附报价侧实际生效的 tier）。tier 是装配层解析的，随结果带回——
 *  IKIZQ7：报价入口要用「同一份等级」组装 quote_revision（契约 §2：冻结输入 +
 *  能力规则 + 用户等级 + 目录版本），不能在入口再解析一次（两次解析可能不一致）。 */
export type BillingQuote = (
  ctx: BillingQuoteContext,
) => Promise<(BillingQuoteResult & { tier: string }) | null>;

export function createBillingQuote(deps: BillingQuoteDeps): BillingQuote {
  return async (ctx) => {
    let tier = 'free';
    try {
      tier = await deps.resolveTier(ctx.userId);
    } catch (error) {
      // 与 Hold 同一条规则：等级取不到按 free 继续（这里连提交都不阻断）。
      // 不静默 —— 少给折扣是钱漏，得有人能从日志里看出来。
      deps.logger?.warn(
        `[billing] 报价时用户等级解析失败，按 free 处理：user=${ctx.userId} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const result = await deps.client.quote({
        userId: Number(ctx.userId),
        modelId: ctx.modelId,
        taskType: ctx.taskType,
        specs: extractSpecs(ctx.input, ctx.taskType),
        tier,
        ...(ctx.ruleSnapshot !== undefined ? { ruleSnapshot: ctx.ruleSnapshot } : {}),
      });
      return { ...result, tier };
    } catch (error) {
      // 算不出价多半是**定价漏配**（契约：INVALID_ARGUMENT / UNPRICEABLE），
      // 也可能是 billing 不可用（UNAVAILABLE）。两者都降级，但都要留下痕迹：
      // 漏配清单就是从这类日志里攒出来的。
      deps.logger?.warn(
        `[billing] 报价失败，本次不写估算（降级，不阻断提交）：` +
          `model=${ctx.modelId} task=${ctx.taskType} ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };
}
