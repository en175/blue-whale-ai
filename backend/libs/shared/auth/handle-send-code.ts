import {
  ACCOUNT_ERROR_INVALID_PURPOSE,
  FAILURE_CODE,
  LEGACY_VERIFICATION_PURPOSE,
  fail,
  isVerificationPurpose,
  ok,
} from "@lib/contracts";
import { isValidPhone, type RequestSmsCodeDeps, requestSmsCode } from "@lib/core";

export interface SendCodeInput {
  phone?: unknown;
  purpose?: unknown;
  ip: string;
}

export async function handleSendCode(
  input: SendCodeInput,
  deps: RequestSmsCodeDeps,
) {
  const phone = input.phone;
  if (!isValidPhone(phone)) {
    return fail(FAILURE_CODE, "手机号格式不正确");
  }
  const purpose =
    input.purpose === undefined || input.purpose === null || input.purpose === ""
      ? LEGACY_VERIFICATION_PURPOSE
      : input.purpose;
  if (purpose !== LEGACY_VERIFICATION_PURPOSE && !isVerificationPurpose(purpose)) {
    return fail(FAILURE_CODE, "验证码用途不正确", null, ACCOUNT_ERROR_INVALID_PURPOSE);
  }
  try {
    await requestSmsCode({ phone, purpose, ip: input.ip }, deps);
    return ok();
  } catch {
    return fail(FAILURE_CODE, "短信发送失败");
  }
}
