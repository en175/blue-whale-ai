import { creditsToNumber, quotaToCredits } from "@lib/shared/credits/credits.js";
import { QUOTA_PER_UNIT } from "@lib/shared/topup-tier/constants.js";

export type RechargeRecordStatus = "success" | "failed" | "pending";

/** Go TopUpStatus → 展示三态；expired（二维码超时未付）归入失败。 */
export function mapTopUpStatus(status: string): RechargeRecordStatus {
  if (status === "success") return "success";
  if (status === "failed" || status === "expired") return "failed";
  return "pending";
}

/** Go payment_method → 展示文案；BlueWhalePay 单恒为「扫码支付」（Go 未落库 wayCode）。 */
export function mapPaymentMethodLabel(paymentMethod: string): string {
  switch (paymentMethod) {
    case "wechat":
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
