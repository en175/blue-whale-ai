import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "./cookie.js";

export function extractLoginToken(request: Request): string | null {
  const header = request.headers?.authorization;
  if (typeof header === "string") {
    const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (matched?.[1]) return matched[1].trim();
  }
  const cookie = request.cookies?.[SESSION_COOKIE_NAME];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}
