export const CAPTCHA_TTL_MS = 60_000;
export const CAPTCHA_TOLERANCE_PX = 5;
export const CAPTCHA_WIDTH = 320;
export const CAPTCHA_HEIGHT = 160;
export const CAPTCHA_PIECE_SIZE = 56;

export function isCaptchaAligned(actualX: unknown, expectedX: number): boolean {
  if (typeof actualX !== "number" || !Number.isFinite(actualX)) return false;
  return Math.abs(actualX - expectedX) <= CAPTCHA_TOLERANCE_PX;
}
