export const NEW_PASSWORD_MIN_LENGTH = 8;
export const NEW_PASSWORD_MAX_LENGTH = 20;
export const NEW_PASSWORD_PLACEHOLDER = '8-20 位';

/** 新密码长度对齐网关/BFF 契约（IKBRCK）：8–20，不以工单初稿 9–20 为准。 */
export function isNewPasswordLengthValid(password: string): boolean {
  return password.length >= NEW_PASSWORD_MIN_LENGTH && password.length <= NEW_PASSWORD_MAX_LENGTH;
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
