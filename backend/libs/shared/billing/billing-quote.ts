import type { BillingClient, BillingQuoteResult } from './billing-client.js';
import { extractSpecs } from './billing-specs.js';

export interface BillingQuoteContext {
  userId: string;
  modelId: string;
  taskType: string;
  input: Record<string, unknown>;
  ruleSnapshot?: string;
}

export interface BillingQuoteDeps {
  client: BillingClient;
  resolveTier: (userId: string) => Promise<string>;
  logger?: { warn: (message: string) => void };
}

export type BillingQuote = (
  ctx: BillingQuoteContext,
) => Promise<(BillingQuoteResult & { tier: string }) | null>;

export function createBillingQuote(deps: BillingQuoteDeps): BillingQuote {
  return async (ctx) => {
    let tier = 'free';
    try {
      tier = await deps.resolveTier(ctx.userId);
    } catch (error) {
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
      deps.logger?.warn(
        `[billing] 报价失败，本次不写估算（降级，不阻断提交）：` +
          `model=${ctx.modelId} task=${ctx.taskType} ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };
}
