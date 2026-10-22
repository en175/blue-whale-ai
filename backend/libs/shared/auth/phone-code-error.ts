import {
  ACCOUNT_ERROR_CODE_ATTEMPTS_EXHAUSTED,
  ACCOUNT_ERROR_CODE_EXPIRED,
  ACCOUNT_ERROR_CODE_WRONG,
} from "@lib/contracts";
import {
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
} from "@lib/shared/identity/identity.service.js";

export interface PhoneCodeFailure {
  status: number;
  message: string;
  errorCode: string;
}

export function projectPhoneCodeError(error: unknown): PhoneCodeFailure | null {
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
  return null;
}
