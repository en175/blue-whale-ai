import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@lib/core";
import { RATE_LIMITED } from "@lib/contracts";
import type { Request } from "express";
import { RateLimiter } from "./rate-limiter.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitKey,
  type RateLimitOptions,
} from "./decorators/rate-limit.decorator.js";

type RequestWithUser = Request & { user?: { userId?: string } };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options?.buckets.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    for (const bucket of options.buckets) {
      const key = extractKey(request, bucket.key);
      if (!key) continue;
      const result = await this.limiter.take({
        scope: bucket.scope,
        key,
        limit: bucket.limit,
        windowMs: bucket.windowMs,
      });
      if (!result.allowed) {
        throw new NewApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
      }
    }
    return true;
  }
}

export function extractKey(request: RequestWithUser, kind: RateLimitKey): string | null {
  if (kind === "ip") {
    const forwarded = request.headers["x-forwarded-for"];
    const raw =
      typeof forwarded === "string"
        ? forwarded.split(",")[0]?.trim()
        : Array.isArray(forwarded)
          ? String(forwarded[0] ?? "").trim()
          : "";
    if (raw) return raw;
    return request.ip && request.ip.length > 0 ? request.ip : null;
  }
  if (kind === "account") {
    const username = (request.body as { username?: unknown } | undefined)?.username;
    return typeof username === "string" && username.trim() ? username.trim() : null;
  }
  const userId = request.user?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}
