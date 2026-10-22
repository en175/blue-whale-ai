import { ApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_ACCOUNT_DELETED,
  ACCOUNT_ERROR_ACCOUNT_DISABLED,
  ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
  ACCOUNT_ERROR_CODE_EXPIRED,
  ACCOUNT_ERROR_CODE_WRONG,
  ACCOUNT_ERROR_INVALID_PURPOSE,
  ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
  ACCOUNT_ERROR_NICKNAME_INVALID,
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_PASSWORD_INVALID,
  ACCOUNT_ERROR_PHONE_NOT_BOUND,
  ACCOUNT_ERROR_PHONE_TAKEN,
  ACCOUNT_ERROR_REBIND_BINDING_CHANGED,
  ACCOUNT_ERROR_REBIND_SAME_PHONE,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  accountErrorToNumeric,
  accountMessageFor,
} from "@lib/contracts";
import {
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  InvalidPhoneCodeInputError,
  InvalidPhoneError,
  InvalidPurposeError,
} from "@lib/shared/auth/phone-verification.service.js";
import {
  AccountDeletedError,
  AccountDisabledError,
  InvalidCredentialsError,
  MigrationIneligibleError,
  NicknameInvalidError,
  PhoneAlreadyBoundError,
  PhoneNotBoundError,
  RebindBindingChangedError,
  RebindSamePhoneError,
} from "@lib/shared/identity/identity.service.js";
import { PasswordPolicyError } from "@lib/shared/identity/password.js";
import {
  PhoneTakenError,
  UsernameTakenError,
} from "@lib/shared/persistence/identity-user-repo.js";

const AUTH_MESSAGES = new Map<number, string>([
  [401, "登录凭证无效"],
  [403, "账户已停用"],
  [502, "账户服务响应异常"],
  [503, "账户服务暂不可用"],
]);

const FALLBACK_MESSAGE = "账户服务响应异常";

export interface AuthFailureProjection {
  status: number;
  message: string;
  errorCode?: string;
}

export function projectAuthFailure(
  error: unknown,
): AuthFailureProjection | null {
  if (error instanceof InvalidPhoneError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InvalidPhoneCodeInputError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InvalidPurposeError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_INVALID_PURPOSE,
    };
  }
  if (error instanceof CodeWrongError) {
    return {
      status: 400,
      message: `验证码错误，请重新输入（还可尝试${error.remaining}次）`,
      errorCode: ACCOUNT_ERROR_CODE_WRONG,
    };
  }
  if (error instanceof CodeAttemptsExhaustedError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
    };
  }
  if (error instanceof CodeExpiredError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_CODE_EXPIRED,
    };
  }
  if (error instanceof AccountDisabledError) {
    return {
      status: 403,
      message: error.message,
      errorCode: ACCOUNT_ERROR_ACCOUNT_DISABLED,
    };
  }
  if (error instanceof AccountDeletedError) {
    return {
      status: 403,
      message: error.message,
      errorCode: ACCOUNT_ERROR_ACCOUNT_DELETED,
    };
  }
  if (error instanceof PhoneTakenError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_PHONE_TAKEN,
    };
  }
  if (error instanceof PhoneNotBoundError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_PHONE_NOT_BOUND,
    };
  }
  if (error instanceof PhoneAlreadyBoundError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof RebindSamePhoneError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_REBIND_SAME_PHONE,
    };
  }
  if (error instanceof RebindBindingChangedError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_REBIND_BINDING_CHANGED,
    };
  }
  if (error instanceof MigrationIneligibleError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_MIGRATION_INELIGIBLE,
    };
  }
  if (error instanceof NicknameInvalidError) {
    return {
      status: 400,
      message: error.message,
      errorCode: ACCOUNT_ERROR_NICKNAME_INVALID,
    };
  }
  if (error instanceof UsernameTakenError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof PasswordPolicyError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof InvalidCredentialsError) {
    return {
      status: 401,
      message: error.message,
      errorCode: "invalid_credentials",
    };
  }
  return null;
}

export function projectPasswordChangeFailure(
  error: unknown,
  fallbackMessage: string,
): { code: number; message: string } {
  if (error instanceof PasswordPolicyError) {
    return {
      code: accountErrorToNumeric(ACCOUNT_ERROR_PASSWORD_INVALID),
      message: error.message,
    };
  }
  if (error instanceof InvalidCredentialsError) {
    return {
      code: accountErrorToNumeric(ACCOUNT_ERROR_PASSWORD_INCORRECT),
      message: accountMessageFor(ACCOUNT_ERROR_PASSWORD_INCORRECT),
    };
  }
  return {
    code: ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
    message: fallbackMessage,
  };
}

export function toAuthError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    const message = AUTH_MESSAGES.get(error.status);
    if (message) {
      return new ApiError(message, error.status, error.code);
    }
  }
  return new ApiError(FALLBACK_MESSAGE, 502, "account_service_error");
}
