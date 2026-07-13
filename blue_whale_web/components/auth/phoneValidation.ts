const PHONE_RE = /^1\d{10}$/;

/** 剥除非数字字符并截断到 11 位 */
export function sanitizePhone(s: string): string {
  return s.replace(/\D/g, "").slice(0, 11);
}

/** 合法手机号：首位 1 + 共 11 位 */
export function isValidPhone(s: string): boolean {
  return PHONE_RE.test(s);
}
