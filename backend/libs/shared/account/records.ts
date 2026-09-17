import { NewApiError } from "@blue-whale/core";
import { creditsToNumber, quotaToCredits } from "@lib/shared/credits/credits.js";
import { QUOTA_PER_UNIT } from "@lib/shared/topup-tier/constants.js";

/** new-api LogType：2 = 消耗，6 = 退款。 */
const LOG_TYPE_CONSUME = 2;
const LOG_TYPE_REFUND = 6;

/** 消费记录 `type` 参数白名单（字符串形态，直接比对原始入参）。 */
const ALLOWED_CONSUME_LOG_TYPES = new Set([
  String(LOG_TYPE_CONSUME),
  String(LOG_TYPE_REFUND),
]);

/** 消费记录方向：正常扣费 vs 退回。 */
export type ConsumptionKind = "consume" | "refund";

/**
 * 解析消费记录的 `type` 查询参数：缺省 `[2]`（消耗，保持改动前行为）。
 *
 * 只放行 2 / 6 是**安全边界**而非参数洁癖：上游 `type=0` 是「不加过滤」哨兵，
 * 而 1 充值 / 3 管理 / 4 系统 / 5 错误 / 7 登录都会把账单之外的行混进消费记录。
 * 非法值一律 400，**绝不降级成「不过滤」**——那正是本单要堵的静默错答案。
 *
 * `?type=2&type=6` 取首个（与上游 `c.Query("type")` 同语义），多个类型用逗号表达。
 */
export function parseConsumeLogTypes(searchParams: URLSearchParams): number[] {
  const raw = searchParams.get("type");
  if (raw === null || raw.trim() === "") return [LOG_TYPE_CONSUME];
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.some((part) => !ALLOWED_CONSUME_LOG_TYPES.has(part))) {
    throw new NewApiError("消费记录类型参数非法", 400, "invalid_log_type");
  }
  return parts.map((part) => Number(part));
}

export type RechargeRecordStatus = "success" | "failed" | "pending";

/** Go TopUpStatus → 展示三态；expired（二维码超时未付）归入失败。 */
export function mapTopUpStatus(status: string): RechargeRecordStatus {
  if (status === "success") return "success";
  if (status === "failed" || status === "expired") return "failed";
  return "pending";
}

/** Go payment_method → 展示文案。
 *  新单渠道族值 `wxpay`/`alipay`；存量可能是 `wechat`/`bluewhalepay`。 */
export function mapPaymentMethodLabel(paymentMethod: string): string {
  switch (paymentMethod) {
    case "wechat":
    case "wxpay":
      return "微信";
    case "alipay":
      return "支付宝";
    case "bluewhalepay":
      return "扫码支付";
    default:
      return "其他";
  }
}

/** 充值获得积分：到账 quota = amount(N) × QuotaPerUnit，再走展示层换算。 */
export function topUpCreditsGained(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return creditsToNumber(quotaToCredits(amount * QUOTA_PER_UNIT));
}

/** 消费积分：Log.quota 走展示层换算，保留 2 位小数。 */
export function consumeCredits(quota: number): number {
  if (!Number.isFinite(quota) || quota <= 0) return 0;
  return creditsToNumber(quotaToCredits(quota));
}

/** 消费摘要（简单版）：按模型名映射业务语义。 */
export function summarizeConsumption(modelName: string): string {
  const name = modelName.toLowerCase();
  if (name.includes("seedream")) return "生成图片";
  if (name.includes("seedance")) return "生成视频";
  return "内容生成";
}

/** 退款摘要：标出「退款」，让两类流水在同一列表里一眼可分。 */
export function summarizeRefund(modelName: string): string {
  return `退款（${summarizeConsumption(modelName)}）`;
}

/** 用户侧消费记录：摘要 + 透传 Go `model_name`。
 *
 *  IKGCWU：退款(6) 与消耗(2) 现在会落在同一个列表里，必须给出**方向**。退款的 `quota`
 *  在上游记的是正数（退回量），照搬 `consumeCredits` 就会被读成「又扣了一笔」。这里让
 *  `credits` 保持**正的变动幅度**（与充值侧 `topUpCreditsGained` 同口径：数值不含符号，
 *  方向由端点或字段表达），方向交给 `kind`；展示端据此决定符号与图标，而不是去猜数值正负。
 *  也因此不能改成"退款返回负 credits"——端到端展示层（`AccountRecordsModal`）现在是按
 *  「credits 为幅度、自己补 `-`」写的。 */
export function toAccountConsumptionItem(log: {
  id: number;
  type: number;
  quota: number;
  model_name: string;
  created_at: number;
}): {
  id: number;
  kind: ConsumptionKind;
  credits: number;
  summary: string;
  model: string;
  created_at: number;
} {
  const kind: ConsumptionKind =
    log.type === LOG_TYPE_REFUND ? "refund" : "consume";
  return {
    id: log.id,
    kind,
    credits: consumeCredits(log.quota),
    summary:
      kind === "refund"
        ? summarizeRefund(log.model_name)
        : summarizeConsumption(log.model_name),
    model: log.model_name,
    created_at: log.created_at,
  };
}

/** 记录列表分页参数解析：p/page_size，非法/缺省 → 第 1 页 20 条；上限 100。 */
export function parseRecordPaging(searchParams: URLSearchParams): {
  page: number;
  pageSize: number;
} {
  const page = Number(searchParams.get("p"));
  const pageSize = Number(searchParams.get("page_size"));
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize:
      Number.isInteger(pageSize) && pageSize > 0 ? Math.min(100, pageSize) : 20,
  };
}
