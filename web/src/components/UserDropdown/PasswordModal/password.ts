import { isPasswordSettable, PASSWORD_MIN_LENGTH } from '@/lib/password';

export { isPasswordSettable };

/** 新密码长度下限（文案里要单独用到）。 */
export const NEW_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
export const NEW_PASSWORD_PLACEHOLDER = '8 位以上';

/**
 * 新密码是否合规。
 *
 * ⚠️ 规则本体在 `@/lib/password`（与后端 `hashPassword` 同口径：至少 8 位、至多 72 **字节**）。
 */
export function isNewPasswordLengthValid(password: string): boolean {
  return isPasswordSettable(password);
}

export function canSubmitPasswordChange(input: {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}): boolean {
  return (
    input.oldPassword.trim().length > 0 &&
    isNewPasswordLengthValid(input.newPassword) &&
    input.confirmPassword === input.newPassword
  );
}
