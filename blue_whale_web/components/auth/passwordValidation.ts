/** 合法密码：8-128 位，且包含字母和数字（与后端 PASSWORD_PATTERN 对齐） */
export function isValidPassword(s: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/.test(s);
}
