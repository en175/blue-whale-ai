export const PHONE_RE = /^1[3-9]\d{9}$/;

export function isValidPhone(value: unknown): value is string {
  return typeof value === "string" && PHONE_RE.test(value);
}
