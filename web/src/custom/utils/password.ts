export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_RULE_HINT = "密码至少 8 位（最长 72 字节，一个汉字算 3 字节）";

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

export function isPasswordSettable(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH && passwordByteLength(password) <= PASSWORD_MAX_BYTES
  );
}
