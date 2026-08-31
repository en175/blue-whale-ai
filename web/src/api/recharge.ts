/* ============================================
 * recharge 接口：充值档位/创建订单/状态轮询/取消，对接真实后端
 * ============================================ */
import { apiRequest } from './http';

/** 充值档位（GET /api/recharge/tiers） */
export interface RechargeTier {
  /** 档位唯一标识 */
  id: string;
  /** 档位名称 */
  name: string;
  /** 到账积分数 */
  amount: number;
  /** 实付价格（元） */
  price: number;
  /** 原价（元），可能为 null */
  original_price: number | null;
  /** 折扣比例，1 = 无折扣 */
  discount: number;
  /** 是否推荐档位 */
  is_recommended: boolean;
  /** 排序权重，越小越靠前 */
  sort_order: number;
}

/** 创建订单结果（POST /api/recharge/order） */
export interface RechargeOrder {
  /** 订单号，用于后续查询/取消 */
  trade_no: string;
  /** 支付二维码 URL（微信 WX_NATIVE / 支付宝 ALI_QR） */
  qr_code_url: string;
  /** 二维码过期时间（ISO 8601，15 分钟有效期） */
  expire_time: string;
  /** 实付金额（元） */
  amount: number;
  /** 到账积分数 */
  points: number;
}

/** 订单状态：pending 待支付 / paid 已支付 / expired 已过期 / failed 失败 */
export type RechargeOrderState = 'pending' | 'paid' | 'expired' | 'failed';

/** 订单支付状态（GET /api/recharge/order/:tradeNo/status） */
export interface RechargeOrderStatus {
  trade_no: string;
  status: RechargeOrderState;
  /** 支付成功后的账户余额，仅 paid 返回，其余为 null */
  credits_after: number | null;
}

/** 获取充值档位列表（仅 active 且在时间窗口内） */
export function fetchRechargeTiers() {
  return apiRequest<{ tiers: RechargeTier[] }>('/api/recharge/tiers').then(
    (d) => d?.tiers ?? [],
  );
}

/** 创建充值订单，返回支付二维码链接 */
export function createRechargeOrder(
  tierId: string,
  paymentMethod: 'wechat' | 'alipay',
) {
  return apiRequest<RechargeOrder>('/api/recharge/order', {
    method: 'POST',
    body: JSON.stringify({ tier_id: tierId, payment_method: paymentMethod }),
  });
}

/** 查询订单支付状态 */
export function fetchRechargeOrderStatus(tradeNo: string) {
  return apiRequest<RechargeOrderStatus>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
  );
}

/** 取消未支付订单（幂等 no-op） */
export function cancelRechargeOrder(tradeNo: string) {
  return apiRequest<null>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/cancel`,
    { method: 'POST' },
  );
}
