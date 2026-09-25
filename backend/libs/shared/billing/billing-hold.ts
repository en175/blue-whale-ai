/* ============================================
 * 预扣（Hold）的装配 —— 把 billing 客户端、用户等级、规格提取拼成 handler 要的那个回调
 *
 * 这层存在的理由：handler 知道「哪个用户、哪个 job、什么模型」，但**不知道**
 * 用户等级（identity 域）与规格怎么归一（定价域）。让它自己拼就会把两个域的知识
 * 塞进生成流程里。所以回调在这里成形，handler 只负责在正确的时机调用它。
 *
 * ⚠️ 规格归一与报价（Quote）**共用** `billing-specs.ts` 那一份（见该文件说明）：
 *    Hold 与 Quote 必须按同一份规格查同一份目录，否则预览价与实际扣价会分叉。
 * ============================================ */
import type { BillingClient } from './billing-client.js';
import { extractSpecs } from './billing-specs.js';

/** handler 交过来的上下文。 */
export interface BillingHoldContext {
  userId: string;
  jobId: number;
  commandId: string;
  modelId: string;
  taskType: string;
  input: Record<string, unknown>;
}

/** 预扣依赖的成品形状（装配层注入给 handler 的那个回调）。 */
export type BillingHold = (ctx: BillingHoldContext) => Promise<void>;

export interface BillingHoldDeps {
  client: BillingClient;
  /** 用户等级（identity 域）。取不到时返回 free —— 保守方向：不打折，不会多让利 */
  resolveTier: (userId: string) => Promise<string>;
  logger?: { warn: (message: string) => void };
}

export function createBillingHold(deps: BillingHoldDeps): BillingHold {
  return async (ctx) => {
    let tier = 'free';
    try {
      tier = await deps.resolveTier(ctx.userId);
    } catch (error) {
      // 等级取不到**不阻断**：按 free 走（不打折、不放行限等级活动）。
      // 走另一个方向（取不到就放行更高折扣）会在错误时多让利，那是钱漏。
      deps.logger?.warn(
        `[billing] 用户等级解析失败，按 free 处理：user=${ctx.userId} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // 抛出的异常原样冒泡：余额不足 → 提交被拒；billing 不可用 → 提交被拒（fail closed）。
    // 在事务里抛 = 整体回滚，不会留下「建了 job 但没冻钱」。
    //
    // ⚠️ **这条路径没有「跳过预扣」的分支**，也不该有：new-api 已被切断，我们不再有第二个
    //    扣费方。任何让这里变成空操作的开关都等于一条静默的免费通道。
    await deps.client.hold({
      userId: Number(ctx.userId),
      commandId: ctx.commandId,
      jobId: ctx.jobId,
      modelId: ctx.modelId,
      taskType: ctx.taskType,
      specs: extractSpecs(ctx.input),
      tier,
    });
  };
}
