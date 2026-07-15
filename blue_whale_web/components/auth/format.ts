/**
 * format —— 账号中心展示用纯函数。
 *
 * maskPhone：手机号脱敏（保留前 3 + 后 4，中间 ****）。
 * 长度不足 11 位时不脱敏，直接原文返回（避免短号被当作完整手机号误脱敏成空串）。
 * getErrorMessage：错误归一，抽取 ApiError/Error 的 message，否则返回 fallback。
 */

/** 手机号脱敏：138****1234。非 11 位原样返回（防止异常短号泄露或误处理）。 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length !== 11) return phone;
  return phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
}

/**
 * 错误归一：优先取 ApiError/Error 的 message，否则返回 fallback。
 * 抽取自 ProfileModal/RebindPhoneModal 的重复三元表达式。
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  return fallback;
}
