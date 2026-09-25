/* ============================================
 * recharge 接口：充值档位目录 / 创建订单 / 查询订单状态
 * 对接我们自己的支付网关（blue-whale-pay 的**杭州银行聚合主扫**）
 *
 * ⚠️ 只有一个渠道：银行返回统一收银台链接，用户在银行页面上自选微信/支付宝/云闪付。
 *    所以下单不传 payment_method，前端也不做渠道切换——那是银行的页面，不是我们的。
 * ⚠️ 没有取消/关单接口：支付网关侧未实现关单，本地订单自然过期（expired）。
 *    不要加回 cancel：那只会是一个前端以为撤了单、实际订单仍能付款成功的空壳。
 * ============================================ */
import { apiRequest } from './http';

/** 充值档位 */
export interface RechargeTier {
  /** 档位唯一标识 */
  id: string;
  /** 档位名称 */
  name: string;
  /** 到账积分（后端按定价目录的 creditsPerYuan 派生：原价 × credits_per_yuan） */
  amount: number;
  /** 实付价格（元） */
  price: number;
  /** 原价（元），无原价时为 null */
  original_price: number | null;
  /** 折扣比例，1 = 无折扣 */
  discount: number;
  /** 是否推荐档位 */
  is_recommended: boolean;
  /** 排序权重，越小越靠前 */
  sort_order: number;
}

/** 档位目录 + 当前生效的换算率（1 元 = 多少积分，来自 billing 定价目录，**不是常量**） */
export interface RechargeTierCatalog {
  tiers: RechargeTier[];
  credits_per_yuan: number;
}

/** 创建订单结果 */
export interface RechargeOrder {
  /** 订单号（我们自己的商户订单号），用于查单 */
  trade_no: string;
  /** 收银台链接 —— 前端自己渲染二维码（qrcode.react 的 QRCodeSVG） */
  qr_code_url: string;
  /** 收银台令牌失效时间（ISO 8601） */
  expire_time: string;
  /** 实付金额（元） */
  amount: number;
  /** 到账积分 */
  points: number;
}

/** 订单状态：pending 待支付 / paid 已支付（积分已发放）/ expired 已过期 / failed 失败 */
export type RechargeOrderState = 'pending' | 'paid' | 'expired' | 'failed';

/** 订单支付状态 */
export interface RechargeOrderStatus {
  trade_no: string;
  status: RechargeOrderState;
  /** 支付成功后的可用积分余额；仅 paid 有值，其余为 null */
  credits_after: number | null;
}

/**
 * 拉取充值档位目录（公开接口）。
 *
 * silent：调用方（充值弹窗）自己有「档位加载失败」的就地错误态，让 http 层再弹一次
 * 全局 toast 就是同一件事说两遍。
 */
export function fetchRechargeTierCatalog() {
  return apiRequest<RechargeTierCatalog>('/api/recharge/tiers', { silent: true });
}

/** 创建充值订单（需登录）。失败由调用方就地展示，故 silent（下单按钮旁边就是错误位） */
export function createRechargeOrder(tierId: string) {
  return apiRequest<RechargeOrder>('/api/recharge/order', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ tier_id: tierId }),
  });
}

/**
 * 查询订单支付状态（需登录）。
 *
 * silent：这是 3s 一次的轮询接口，网关抖动时每一次失败都弹 toast 会把屏幕糊满，
 * 而用户真正需要的信息是「还在等支付结果」——那由弹窗自己维持。
 */
export function fetchRechargeOrderStatus(tradeNo: string) {
  return apiRequest<RechargeOrderStatus>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
    { silent: true },
  );
}
