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

/** 桌面端弹窗宽度 */
export const DESKTOP_MODAL_WIDTH = 780;

/** 移动端断点 */
export const MOBILE_BREAKPOINT = 768;
