export const CAPTCHA_TTL_MS = 60_000;
export const CAPTCHA_CODE_LENGTH = 4;
export const CAPTCHA_WIDTH = 120;
export const CAPTCHA_HEIGHT = 44;
export const CAPTCHA_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeCaptchaAnswer(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

export function isCaptchaAnswerCorrect(actual: unknown, expected: string): boolean {
  const normalized = normalizeCaptchaAnswer(actual);
  return normalized.length > 0 && normalized === expected.toUpperCase();
}
