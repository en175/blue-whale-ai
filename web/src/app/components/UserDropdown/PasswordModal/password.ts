import { isPasswordSettable, PASSWORD_MIN_LENGTH } from '@/utils/password';

export { isPasswordSettable };

export const NEW_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
export const NEW_PASSWORD_PLACEHOLDER = '8 位以上';

export function isNewPasswordLengthValid(password: string): boolean {
  return isPasswordSettable(password);
}

export function canSubmitPasswordChange(input: {
  oldPassword: string | null;
  newPassword: string;
  confirmPassword: string;
}): boolean {
  return (
    (input.oldPassword === null || input.oldPassword.trim().length > 0) &&
    isNewPasswordLengthValid(input.newPassword) &&
    input.confirmPassword === input.newPassword
  );
}
