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
  /**
   * 到账积分 = 档位配的基础积分（**配置值，不是派生值**）。
   *
   * ⚠️ 别拿它去除以 `price`：充值常有折扣，¥499 的档到账 7,500 积分
   * （499 × 15 = 7,485 只是巧合）。`price`/`original_price` 只为展示划线价。
   */
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
  /**
   * 当前用户能不能买这一档（PRD §6.3「无权限的档位置灰并展示提示」）。
   *
   * ⚠️ `null` = **未判定**（游客），不是「不能买」：价格表是公开信息，游客照样看得到
   * 整张目录，只是不能下单 —— 与自定义充值那条（`RechargeCustomConfig.can_purchase`）
   * 同一个口径。把 null 当 false，会把一张可看的价目表显示成一排灰卡片。
   */
  can_purchase: boolean | null;
  /** 不能买时展示的文案（后台可配，未配则由服务端给默认文案） */
  denied_hint: string;
}

/** 档位目录 + 当前生效的换算率（1 元 = 多少积分，来自 billing 定价目录，**不是常量**） */
export interface RechargeTierCatalog {
  tiers: RechargeTier[];
  credits_per_yuan: number;
}

/**
 * 自定义充值配置（模块 B，PRD §7.2）。**游客也能拿到**（「游客可见不可买」）。
 *
 * ⚠️ `credits_per_yuan` 是**这张表自己的**换算率（PRD §7.1 默认 15），
 * 与 `RechargeTierCatalog.credits_per_yuan`（定价目录里那条**消费锚点**）**不是一回事**。
 * PRD §7.1 自己注明「与现有展示口径 1 元 = 10 积分不一致，待评审确认」——
 * 看到两个数不一样，**不要去把它们统一起来**。
 */
export interface RechargeCustomConfig {
  /** 是否启用。false = 用户侧不展示自定义充值 */
  enabled: boolean;
  /** 最低可购积分（PRD §7.1 默认 600） */
  min_credits: number;
  /** 最高可购积分（PRD §7.1 默认 499,995） */
  max_credits: number;
  /** 进入时的默认选中值（PRD §7.1 默认 600） */
  default_credits: number;
  /** 滑杆步长（PRD §10.3），手动输入也要对齐到它 */
  step_credits: number;
  /** 每元积分数，价格 = 积分数 ÷ 它（**本表自己的**那条，见上方说明） */
  credits_per_yuan: number;
  /** 到账积分有效期（月），默认 24 = 2 年 */
  credits_valid_months: number;
  /** 当前用户能否购买；**null = 游客，未判定**（PRD §7.4「游客可见不可买」） */
  can_purchase: boolean | null;
  /** 无权限时展示的文案（后台可配，未配则服务端给默认文案） */
  denied_hint: string;
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

/**
 * 订单状态（与后端 `RechargeOrderStatus` 逐字一致，2026-09-26 起 6 态）。
 *
 * <p>`paid_pending`「支付成功待到账」：**钱已经收到了、积分还没发出去** —— 回调先写它、
 * 再调 billing 发放，成功才升到 `paid`。所以轮询到它时**不是终态**，要继续等：
 * 后端会重试发放，界面维持「等待支付结果…」才是对的。
 *
 * <p>`grant_failed`「到账异常」：发放反复失败、需人工介入（由对账任务写入）。
 */
export type RechargeOrderState =
  | 'pending'
  | 'paid_pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'grant_failed';

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
 * 拉取自定义充值配置（公开接口 —— 游客也要能看到价格与范围，PRD §7.4）。
 *
 * silent：调用方自己有「加载失败」的就地错误态，让 http 层再弹一次全局 toast
 * 就是同一件事说两遍。
 */
export function fetchRechargeCustomConfig() {
  return apiRequest<RechargeCustomConfig>('/api/recharge/custom', { silent: true });
}

/**
 * 创建自定义充值订单（需登录）。
 *
 * ⚠️ 只传**积分数**，不传价格：价格一律服务端按当前配置算（PRD §7.5「以服务端最新配置为准」）。
 * 前端界面上那个价只是展示 —— 传上去也没人看，反而会让人以为「前端能定价」。
 */
export function createCustomRechargeOrder(credits: number) {
  return apiRequest<RechargeOrder>('/api/recharge/order', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ credits }),
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
