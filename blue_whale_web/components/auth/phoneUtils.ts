/**
 * 手机号脱敏工具
 */

/** "138****1234" — 中间 4 位替换为 **** */
export function maskPhone(phone: string): string {
  if (!phone || phone.length !== 11) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(7);
}
