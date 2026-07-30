/**
 * recharge.dto — 充值相关接口契约 DTO（前后端共用参照）
 *
 * Go 后端按此结构返回 JSON。前端用 apiRequest<T>() 消费。
 * 命名约定: snake_case（与后端 JSON 一致，不做转换）。
 */

// ---------- GET /api/recharge/tiers ----------

export type RechargeTierDto = {
  id: string; // "tier_100"
  name: string; // 档位名称
  amount: number; // 购买积分数
  price: number; // 价格（元）
  original_price?: number | null; // 原价
  bonus: number; // 赠送积分，0 = 无赠送
  is_recommended: boolean; // 推荐档位
  sort_order: number;
};

export type RechargeTiersResponse = {
  tiers: RechargeTierDto[];
};

// ---------- POST /api/recharge/order ----------

export type CreateOrderRequest = {
  tier_id: string;
  payment_method: "wechat" | "alipay";
};

export type CreateOrderResponse = {
  trade_no: string;
  qr_code_url: string;
  expire_time: string; // ISO 8601
  amount: number; // 实付金额（元）
  points: number; // 到账积分（含赠送）
};

// ---------- GET /api/recharge/order/:tradeNo/status ----------

export type OrderStatus = "pending" | "paid" | "expired" | "failed";

export type OrderStatusResponse = {
  trade_no: string;
  status: OrderStatus;
  credits_after: number | null; // paid 时返回新余额
};

// ---------- GET /api/recharge/agreement ----------

export type RechargeAgreementResponse = {
  title: string;
  content: string; // Markdown 或 HTML
};
