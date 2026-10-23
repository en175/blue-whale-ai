export const PHONE_RE = /^1[3-9]\d{9}$/;

export function isValidPhone(value: unknown): value is string {
  return typeof value === "string" && PHONE_RE.test(value);
}

export function maskPhone(value: string): string {
  if (!PHONE_RE.test(value)) return "***";
  return `${value.slice(0, 3)}****${value.slice(7)}`;
}
