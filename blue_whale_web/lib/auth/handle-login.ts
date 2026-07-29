import { FAILURE_CODE, fail, ok } from "@blue-whale/contracts";
import {
  InvalidVerificationCodeError,
  type LoginWithCodeDeps,
  loginWithCode,
} from "@blue-whale/core";

const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_RE = /^\d{6}$/;

export interface LoginInput {
  phone?: unknown;
  code?: unknown;
}

/** login 路由处理器：手机号+码校验 → loginWithCode → {code,msg,data:{accessToken,user}}，异常兜成 400。 */
export async function handleLogin(input: LoginInput, deps: LoginWithCodeDeps) {
  const phone = typeof input.phone === "string" ? input.phone : "";
  const code = typeof input.code === "string" ? input.code : "";
  if (!PHONE_RE.test(phone) || !CODE_RE.test(code)) {
    return fail(FAILURE_CODE, "手机号或验证码格式不正确");
  }
  try {
    const result = await loginWithCode({ phone, code }, deps);
    return ok(result);
  } catch (e) {
    if (e instanceof InvalidVerificationCodeError) {
      return fail(FAILURE_CODE, "验证码无效或已过期");
    }
    return fail(FAILURE_CODE, "登录失败");
  }
}
