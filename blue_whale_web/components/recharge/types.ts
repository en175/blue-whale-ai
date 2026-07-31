/**
 * recharge types — 充值弹窗纯类型（数据层，无 JSX / 无副作用）
 */

/** 支付方式 */
export type PaymentMethod = "wechat" | "alipay";

/** 充值档位（来自运营后台 IK39UN / IK51OP） */
export type RechargeTier = {
  id: string;
  /** 购买积分数 */
  amount: number;
  /** 原价（元） */
  originalPrice: number;
  /** 折扣比例，1 = 无折扣，0.85 = 八五折 */
  discount: number;
  /** 实付价格（元）= originalPrice × discount */
  price: number;
  /** 推荐档位（运营勾选） */
  isRecommended: boolean;
  /** 排序权重 */
  sortOrder: number;
};

/** 充值订单 */
export type RechargeOrder = {
  tradeNo: string;
  qrCodeUrl: string;
  expireTime: string; // ISO 8601
  amount: number;
  points: number;
  paymentMethod: PaymentMethod;
};

/** 充值流程状态机 */
export type FlowState =
  | "IDLE"
  | "CONFIRMING"
  | "CREATING_ORDER"
  | "QR_READY"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "EXPIRED"
  | "CANCELLED";

/** 积分不足上下文（入口 3 传入） */
export type Shortfall = {
  /** 本次生成所需积分 */
  need: number;
  /** 当前余额 */
  balance: number;
  /** 还差多少 */
  missing: number;
};

/** 轮询状态 */
export type PollState = {
  isPolling: boolean;
  errorCount: number;
  maxErrors: number;
};

/** 档位列表加载状态 */
export type TierLoadState = "loading" | "empty" | "error" | "normal";
