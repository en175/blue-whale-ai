import type { CookieOptions, Response } from "express";

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

export function applySessionCookie(
  res: Pick<Response, "cookie">,
  token: string,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(
  res: Pick<Response, "clearCookie">,
): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...sessionCookieOptions(),
    maxAge: undefined,
  });
}
