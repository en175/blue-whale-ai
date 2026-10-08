import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "./cookie.js";

export function extractLoginToken(request: Request): string | null {
  // `?.` 不是洁癖：这条函数也会被 `@Public()` 路由调用，而那些路由的测试替身常常
  // 只造 `cookies` 不造 `headers`——真 Express 请求两者都在，但替身不该因此炸。
  const header = request.headers?.authorization;
  if (typeof header === "string") {
    const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (matched?.[1]) return matched[1].trim();
  }
  const cookie = request.cookies?.[SESSION_COOKIE_NAME];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}
