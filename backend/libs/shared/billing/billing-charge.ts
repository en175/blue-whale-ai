import { toBillingChargeError, type BillingClient } from './billing-client.js';
import { extractSpecs } from './billing-specs.js';

export interface BillingChargeContext {
  userId: string;
  jobId: number;
  commandId: string;
  modelId: string;
  taskType: string;
  input: Record<string, unknown>;
  ruleSnapshot?: string;
}

export type BillingCharge = (ctx: BillingChargeContext) => Promise<void>;

export interface BillingChargeDeps {
  client: BillingClient;
  resolveTier: (userId: string) => Promise<string>;
  logger?: { warn: (message: string) => void };
}

export function createBillingCharge(deps: BillingChargeDeps): BillingCharge {
  return async (ctx) => {
    let tier = 'free';
    try {
      tier = await deps.resolveTier(ctx.userId);
    } catch (error) {
      deps.logger?.warn(
        `[billing] 用户等级解析失败，按 free 处理：user=${ctx.userId} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await deps.client.charge({
        userId: Number(ctx.userId),
        commandId: ctx.commandId,
        jobId: ctx.jobId,
        modelId: ctx.modelId,
        taskType: ctx.taskType,
        specs: extractSpecs(ctx.input, ctx.taskType),
        tier,
        ...(ctx.ruleSnapshot !== undefined && { ruleSnapshot: ctx.ruleSnapshot }),
      });
    } catch (error) {
      deps.logger?.warn(
        `[billing] 扣款被拒（提交拒绝，fail closed）：user=${ctx.userId} job=${ctx.jobId} ` +
          `model=${ctx.modelId} task=${ctx.taskType} ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw toBillingChargeError(error) ?? error;
    }
  };
}
