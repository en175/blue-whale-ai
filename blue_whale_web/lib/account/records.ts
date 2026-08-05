/**
 * 账户记录（充值/消费）Go → 前端展示映射（IK39UR）。
 *
 * 数据源：Go /api/user/topup/self（TopUp）与 /api/log/self（Log，type=2 消费）。
 * 本文件为纯函数映射，BFF 路由与单测共用。
 *
 * 积分口径与余额展示一致：quota → credits 走 lib/credits.quotaToCredits
 * （new-api quota 是唯一余额真相，credits 是 UI 别名）。充值到账 quota =
 * N × QuotaPerUnit（N = TopUp.amount 美元额度，见 lib/topup-tier/constants.ts）。
 */
import { quotaToCredits } from "@/lib/credits";
import { QUOTA_PER_UNIT } from "@/lib/topup-tier/constants";

/** 充值记录状态（PRD 三态：成功/失败/进行中） */
export type RechargeRecordStatus = "success" | "failed" | "pending";

export interface RechargeRecordItem {
  trade_no: string;
  /** 获得积分（quota → credits 换算后取整） */
  credits: number;
  /** 实付金额（元） */
  amount_cny: number;
  /** 支付方式展示文案（微信/支付宝/扫码支付） */
  payment_method: string;
  status: RechargeRecordStatus;
  /** unix 秒 */
  created_at: number;
}

export interface ConsumptionRecordItem {
  id: number;
  /** 消耗积分（正数；展示层加负号） */
  credits: number;
  /** 生成内容摘要（生成图片/生成视频/内容生成） */
  summary: string;
  /** unix 秒 */
  created_at: number;
}

/**
 * Go common.TopUpStatus* → 展示三态。
 * expired（二维码超时未付）无对应展示态，归入失败（订单已终结未到账）。
 */
export function mapTopUpStatus(status: string): RechargeRecordStatus {
  if (status === "success") return "success";
  if (status === "failed" || status === "expired") return "failed";
  return "pending";
}

/**
 * Go TopUp.payment_method → 展示文案。
 * ⚠️ BlueWhalePay 单恒为 "bluewhalepay"——Go 未持久化 wayCode（WX_NATIVE/ALI_QR），
 * 无法区分微信/支付宝，只能显示「扫码支付」。后续如需区分须 Go 侧落库 wayCode。
 */
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

/** quota → credits 取整（负数/非法 → 0，展示层不出现负积分）。 */
function roundCredits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** 充值获得积分：到账 quota = amount(N) × QuotaPerUnit，再走展示层换算。 */
export function topUpCreditsGained(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return roundCredits(quotaToCredits(amount * QUOTA_PER_UNIT));
}

/** 消费积分：Log.quota 走同一展示层换算。quota>0 但换算不足 1 时保底 1（避免展示「-0」）。 */
export function consumeCredits(quota: number): number {
  if (!Number.isFinite(quota) || quota <= 0) return 0;
  return Math.max(1, Math.round(quotaToCredits(quota)));
}

/**
 * 消费摘要（简单版，不改 Go）：按模型名规则映射业务语义。
 * seedream = 图片生成系（doubao-seedream-*）；seedance = 视频生成系（doubao-seedance-*）。
 * 匹配不到兜底「内容生成」。张数/时长等精细摘要需生成链路回写，后续工单升级。
 */
export function summarizeConsumption(modelName: string): string {
  const name = modelName.toLowerCase();
  if (name.includes("seedream")) return "生成图片";
  if (name.includes("seedance")) return "生成视频";
  return "内容生成";
}

/** 记录列表分页参数解析：p/page_size，非法/缺省 → 第 1 页 20 条；上限 100（与 Go 钳制一致）。 */
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
