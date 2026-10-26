import { PHONE_RE } from "./phone.js";

const TELECOM_PREFIXES: ReadonlySet<string> = new Set([
  "133",
  "149",
  "153",
  "173",
  "177",
  "180",
  "181",
  "189",
  "190",
  "191",
  "193",
  "199",
]);

export function isTelecomPhone(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const digits = value.trim();
  if (!PHONE_RE.test(digits)) return false;
  return TELECOM_PREFIXES.has(digits.slice(0, 3));
}
