/**
 * IK7G9X：生成任务建预留时的成本估算器。
 *
 * 口径对齐 new-api：quota = modelPrice × QuotaPerUnit × groupRatio（视频另有 OtherRatios，
 * 时长/分辨率等，本估算用数量级近似，精确复刻留对账工单）。金额 = quotaToFen(quota)。
 *
 * 失败语义（决策）：new-api 定价不可达 → 返回 null，调用方降级记 0 + 版本 "dev" + 日志，
 * 不 throw、不阻塞建任务。
 */
import {
  buildCostVersions,
  loadGenerationCostConfig,
  quotaToFen,
  type CostReservationSnapshot,
  type NewApiPricingItem,
} from "@blue-whale/core";

export interface CostEstimatorClient {
  /** 拉定价目录（默认匿名可访问；token 可传用户 sk- 以对齐用户分组）。 */
  getPricing(token?: string): Promise<{
    pricing: NewApiPricingItem[];
    pricingVersion?: string;
  }>;
}

export interface EstimateGenerationCostInput {
  modelId: string;
  /** video | image。视频按固定价 × QuotaPerUnit × groupRatio；图片 × n。 */
  type: "image" | "video";
  /** 图片输出张数（expected_output_count）。 */
  expectedOutputCount: number;
  /** 用户 sk- token（可选，传入后 /api/pricing 按用户分组过滤）。 */
  token?: string;
}

export type GenerationCostEstimator = (
  input: EstimateGenerationCostInput,
) => Promise<CostReservationSnapshot | null>;

/** 组装估算器：拉定价 → 估算 quota → 换算 fen + 落四版本。 */
export function createGenerationCostEstimator(
  client: CostEstimatorClient,
): GenerationCostEstimator {
  const config = loadGenerationCostConfig();
  return async (input): Promise<CostReservationSnapshot | null> => {
    let pricingResult;
    try {
      pricingResult = await client.getPricing(input.token);
    } catch {
      return null;
    }
    const item = pricingResult.pricing.find(
      (entry) => entry.modelName === input.modelId,
    );
    // 目录里没有该模型 → 无法估算，降级。
    if (!item) return null;

    // 固定价（model_price>0）优先；为 0/缺失表示按倍率计费（quota_type=0），用 model_ratio。
    // 注意不能用 `??`：model_price=0 是合法值（按倍率计费），?? 只会跳过 null/undefined。
    const basePrice =
      item.modelPrice !== undefined && item.modelPrice > 0
        ? item.modelPrice
        : item.modelRatio;
    if (!Number.isFinite(basePrice) || (basePrice ?? 0) <= 0) return null;

    const multiplier =
      input.type === "image" ? Math.max(1, input.expectedOutputCount) : 1;
    // quota = modelPrice × QuotaPerUnit × groupRatio（groupRatio 取 1，数量级口径）。
    const quota = basePrice! * config.quotaPerUnit * multiplier;

    const versions = buildCostVersions(
      config,
      pricingResult.pricingVersion,
      item.billingMode === "tiered_expr" ? item.billingExpr : undefined,
    );
    return {
      reservedAmountFen: quotaToFen(quota, config),
      ...versions,
    };
  };
}
