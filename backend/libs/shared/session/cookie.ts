import type { CookieOptions } from "express";

/** 登录会话 cookie（HttpOnly，浏览器 JS 不可读，防 XSS 窃取会话）。 */
export const SESSION_COOKIE_NAME = "bw_session";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** cookie 选项：HttpOnly + SameSite=Lax（挡跨站 CSRF POST）+ 生产环境 Secure。 */
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
