import { createHash } from "node:crypto";

function javaCaseInsensitiveCompare(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i += 1) {
    let c1 = a.charCodeAt(i);
    let c2 = b.charCodeAt(i);
    if (c1 === c2) continue;
    c1 = toUpperAscii(c1);
    c2 = toUpperAscii(c2);
    if (c1 !== c2) {
      c1 = toLowerAscii(c1);
      c2 = toLowerAscii(c2);
      if (c1 !== c2) return c1 - c2;
    }
  }
  return a.length - b.length;
}

const toUpperAscii = (c: number): number => (c >= 97 && c <= 122 ? c - 32 : c);
const toLowerAscii = (c: number): number => (c >= 65 && c <= 90 ? c + 32 : c);

export function paySign(params: Record<string, unknown>, appSecret: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "sign") continue;
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${key}=${String(value)}&`);
  }
  parts.sort(javaCaseInsensitiveCompare);
  const payload = `${parts.join("")}key=${appSecret}`;
  return createHash("md5").update(payload, "utf8").digest("hex").toUpperCase();
}

export function verifyPaySign(params: Record<string, string>, appSecret: string): boolean {
  const provided = params.sign;
  if (!provided) return false;
  return timingSafeEqual(paySign(params, appSecret), provided.toUpperCase());
}

function timingSafeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}
