const NICKNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9_-]+$/u;

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

export type NicknameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "length" | "chars" };

export function normalizeNickname(raw: unknown): NicknameValidation {
  if (typeof raw !== "string") return { ok: false, reason: "chars" };
  const value = raw.trim();
  const length = Array.from(value).length;
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: "length" };
  }
  if (!NICKNAME_PATTERN.test(value)) {
    return { ok: false, reason: "chars" };
  }
  return { ok: true, value };
}
