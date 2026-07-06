/**
 * 手机号 / 验证码校验（纯函数，可测）
 *
 * - sanitizePhone：剥非数字 + 截 11 位
 * - isValidPhone：首位 1 + 共 11 位（/^1\d{10}$/）
 * - LOGIN_CODE：L1 写死 "1234"（无真短信服务）
 * - isValidCode：=== LOGIN_CODE
 */

export const LOGIN_CODE = "1234";

const PHONE_RE = /^1\d{10}$/;

/** 剥除非数字字符并截断到 11 位 */
export function sanitizePhone(s: string): string {
  return s.replace(/\D/g, "").slice(0, 11);
}

/** 合法手机号：首位 1 + 共 11 位 */
export function isValidPhone(s: string): boolean {
  return PHONE_RE.test(s);
}

/** 验证码校验：L1 写死 1234 */
export function isValidCode(s: string): boolean {
  return s === LOGIN_CODE;
}
