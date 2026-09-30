/**
 * 手机号口径 —— 发码、验证码登录、绑定手机号**共用同一条正则**。
 *
 * <p>三处各写一份迟早会漂：发码处按宽松口径收下、绑定处按严格口径拒绝，
 * 用户看到的就是「验证码收到了但绑不上」。
 */
export const PHONE_RE = /^1[3-9]\d{9}$/;

/** 是否为可受理的大陆手机号。`unknown` 入参是为了直接接请求体里未经验证的字段。 */
export function isValidPhone(value: unknown): value is string {
  return typeof value === "string" && PHONE_RE.test(value);
}
