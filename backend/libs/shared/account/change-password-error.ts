import {
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_PASSWORD_INVALID,
  ACCOUNT_ERROR_PASSWORD_NOT_SET,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  accountErrorToNumeric,
  accountMessageFor,
} from "@lib/contracts";
import { PasswordPolicyError } from "@lib/shared/identity/index.js";

export interface ProjectedAccountError {
  code: number;
  message: string;
}

export function projectAccountError(
  error: unknown,
  fallbackMessage: string,
): ProjectedAccountError {
  if (error instanceof PasswordPolicyError) {
    return {
      code: accountErrorToNumeric(ACCOUNT_ERROR_PASSWORD_INVALID),
      message: error.message,
    };
  }
  const text =
    error instanceof Error ? error.message : String(error ?? "");
  const pick = (code: string) => ({
    code: accountErrorToNumeric(code),
    message: accountMessageFor(code),
  });
  if (/invalid|length|format|8-20|weak|弱密码|非法/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_INVALID);
  }
  if (/password.*not\s*(set|defined)|未设置密码|no\s*password/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_NOT_SET);
  }
  if (/incorrect|wrong|原密码错误|密码错误/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_INCORRECT);
  }
  return {
    code: ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
    message: fallbackMessage,
  };
}
