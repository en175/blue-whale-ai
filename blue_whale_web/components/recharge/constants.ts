/**
 * recharge constants — 充值弹窗常量配置
 */
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

/** 桌面端弹窗基础宽度（单行横排，卡片高瘦型，宽度适当收窄） */
export const DESKTOP_MODAL_WIDTH = 1120;

/** 套餐卡片行高度（卡片高占满弹窗主体；小屏按视口限高） */
export const TIER_ROW_HEIGHT_CLASS = "h-[min(540px,calc(100vh-280px))]";

/** 右侧支付面板宽度（下单后展开） */
export const PAYMENT_PANEL_WIDTH = 360;

/** 右栏展开后的弹窗宽度上限 */
export const DESKTOP_MODAL_WIDTH_MAX = 1680;

/** 移动端断点 */
export const MOBILE_BREAKPOINT = 768;
