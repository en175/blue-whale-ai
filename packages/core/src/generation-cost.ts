// IK7G9X：生成成本换算纯函数 + 记账快照类型。
// 口径对齐 new-api（quota → 人民币 → 分）：
//   quota = modelPrice × QuotaPerUnit × groupRatio；人民币 = quota/QuotaPerUnit × USDExchangeRate；
//   分(fen) = 人民币 × 100。QuotaPerUnit / USDExchangeRate 走 env，可被运维覆盖。

export interface GenerationCostConfig {
  /** new-api QuotaPerUnit（common/constants.go:39 默认 500000）。 */
  quotaPerUnit: number;
  /** USD→CNY 汇率（new-api USDExchangeRate 默认 7.3）。 */
  usdExchangeRate: number;
  /** cost_rule_version / model_policy_version 缺省版本号。 */
  catalogVersion: string;
}

const DEFAULT_QUOTA_PER_UNIT = 500_000;
const DEFAULT_USD_EXCHANGE_RATE = 7.3;
const DEFAULT_CATALOG_VERSION = "v1";

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 从 env 加载成本换算配置；非法/缺失值回落默认。 */
export function loadGenerationCostConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GenerationCostConfig {
  return {
    quotaPerUnit: finitePositive(
      Number(env.QUOTA_PER_UNIT ?? DEFAULT_QUOTA_PER_UNIT),
      DEFAULT_QUOTA_PER_UNIT,
    ),
    usdExchangeRate: finitePositive(
      Number(env.USD_EXCHANGE_RATE ?? DEFAULT_USD_EXCHANGE_RATE),
      DEFAULT_USD_EXCHANGE_RATE,
    ),
    catalogVersion:
      env.GENERATION_COST_CATALOG_VERSION?.trim() || DEFAULT_CATALOG_VERSION,
  };
}

/** quota → 分(fen)。非正/非法 → 0n；round 到整数分。 */
export function quotaToFen(
  quota: number,
  config: GenerationCostConfig,
): bigint {
  if (!Number.isFinite(quota) || quota <= 0) return 0n;
  const fen = (quota / config.quotaPerUnit) * config.usdExchangeRate * 100;
  return BigInt(Math.round(fen));
}

/** cost_reservations 四个 *_version 字段（camelCase 载体，落库时映射 snake_case）。 */
export interface CostReservationVersions {
  priceCatalogVersion: string;
  exchangeRateVersion: string;
  modelPolicyVersion: string;
  costRuleVersion: string;
}

/**
 * 组装四个版本字段：
 * - price_catalog_version = new-api /api/pricing 响应级 pricing_version（可追溯当次定价目录）
 * - exchange_rate_version = usd-<汇率>（如 usd-7.3）
 * - model_policy_version = 模型 BillingMode/BillingExpr 版本；缺失回落 catalogVersion
 * - cost_rule_version = catalogVersion（本仓记账规则版本）
 */
export function buildCostVersions(
  config: GenerationCostConfig,
  pricingVersion?: string,
  modelPolicyVersion?: string,
): CostReservationVersions {
  return {
    priceCatalogVersion: pricingVersion?.trim() || config.catalogVersion,
    exchangeRateVersion: `usd-${config.usdExchangeRate}`,
    modelPolicyVersion: modelPolicyVersion?.trim() || config.catalogVersion,
    costRuleVersion: config.catalogVersion,
  };
}

/** 建预留时写入 cost_reservations 的记账快照（persistence CreateJobInput.costReservation）。 */
export interface CostReservationSnapshot extends CostReservationVersions {
  reservedAmountFen: bigint;
}
