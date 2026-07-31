/**
 * recharge constants — 充值弹窗常量配置
 */
import type { RechargeTier } from "./types";

/** 轮询间隔（毫秒），前 10s 每 2s，之后每 5s */
export const POLL_INTERVAL_FAST = 2000;
export const POLL_INTERVAL_SLOW = 5000;
export const POLL_FAST_DURATION = 10000; // 10s 内快速轮询
export const POLL_INTERVAL_DEFAULT = 3000;

/** 连续轮询失败上限，超过则降级提示 */
export const POLL_MAX_ERRORS = 3;

/** 二维码有效期（分钟） */
export const QR_EXPIRE_MINUTES = 15;
/** 二维码有效期（秒），方便倒计时用 */
export const QR_EXPIRE_SECONDS = QR_EXPIRE_MINUTES * 60;

/** 支付成功后自动关闭延迟（毫秒） */
export const SUCCESS_AUTO_CLOSE_MS = 3000;

/** 桌面端弹窗宽度 */
export const DESKTOP_MODAL_WIDTH = 780;

/** 移动端断点 */
export const MOBILE_BREAKPOINT = 768;

/** Mock 初始余额 */
export const MOCK_INITIAL_CREDITS = 1000;

/** Mock 档位数据 */
export const MOCK_TIERS: RechargeTier[] = [
  {
    id: "tier_100",
    amount: 100,
    originalPrice: 10.0,
    discount: 1,
    price: 10.0,
    isRecommended: false,
    sortOrder: 0,
  },
  {
    id: "tier_200",
    amount: 200,
    originalPrice: 20.0,
    discount: 0.9,
    price: 18.0,
    isRecommended: true,
    sortOrder: 1,
  },
  {
    id: "tier_500",
    amount: 500,
    originalPrice: 50.0,
    discount: 0.85,
    price: 42.5,
    isRecommended: false,
    sortOrder: 2,
  },
  {
    id: "tier_1000",
    amount: 1000,
    originalPrice: 100.0,
    discount: 0.8,
    price: 80.0,
    isRecommended: false,
    sortOrder: 3,
  },
];
