export const MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/;
export const PHONE_FORMAT_MESSAGE = '请输入中国大陆11位手机号';
export const SMS_SENT_MESSAGE = '验证码已发送，5分钟内有效';

export function isMainlandPhone(raw: string) {
  return MAINLAND_PHONE_PATTERN.test(raw.trim());
}
