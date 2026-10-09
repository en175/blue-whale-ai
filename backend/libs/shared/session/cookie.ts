import type { CookieOptions } from "express";

export const SESSION_COOKIE_NAME = "bw_session";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function sessionCookieOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}
