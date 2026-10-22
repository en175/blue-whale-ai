export const VERIFICATION_PURPOSES = [
  "login",
  "bind",
  "rebind_old",
  "rebind_new",
  "recovery",
] as const;

export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const DEFAULT_VERIFICATION_PURPOSE: VerificationPurpose = "login";

export const LEGACY_VERIFICATION_PURPOSE = "legacy";

export function isVerificationPurpose(value: unknown): value is VerificationPurpose {
  return (
    typeof value === "string" &&
    (VERIFICATION_PURPOSES as readonly string[]).includes(value)
  );
}
