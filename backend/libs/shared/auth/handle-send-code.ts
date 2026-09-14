import { FAILURE_CODE, fail, ok } from "@lib/contracts";
import { type RequestSmsCodeDeps, requestSmsCode } from "@lib/core";

const PHONE_RE = /^1[3-9]\d{9}$/;

export interface SendCodeInput {
  phone?: unknown;
  ip: string;
}

/** send-code 路由处理器：手机号校验 → requestSmsCode → {code,msg,data} 信封，异常兜成 400。 */
export async function handleSendCode(
  input: SendCodeInput,
  deps: RequestSmsCodeDeps,
) {
  const phone = typeof input.phone === "string" ? input.phone : "";
  if (!PHONE_RE.test(phone)) {
    return fail(FAILURE_CODE, "手机号格式不正确");
  }
  try {
    await requestSmsCode({ phone, ip: input.ip }, deps);
    return ok();
  } catch {
    return fail(FAILURE_CODE, "短信发送失败");
  }
}
