import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@lib/core";
import { RATE_LIMITED } from "@lib/contracts";
import type { Request } from "express";
import { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitKey,
  type RateLimitOptions,
} from "./decorators/rate-limit.decorator.js";

type RequestWithUser = Request & { user?: { userId?: string } };

function sanitizeForLog(key: string): string {
  const stripped = key.replace(/[\r\n]/g, "");
  return stripped.length > 64 ? `${stripped.slice(0, 64)}…` : stripped;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    private readonly allowlist: RateLimitAllowlist,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options?.buckets.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const realIp = extractRealIp(request);
    const username = extractKey(request, "account");
    const hit =
      realIp && this.allowlist.isAllowed("ip", realIp)
        ? ({ kind: "ip", value: realIp } as const)
        : username && this.allowlist.isAllowed("account", username)
          ? ({ kind: "account", value: username } as const)
          : null;
    if (hit) {
      this.logger.log(
        `限流豁免名单命中（${hit.kind}: ${sanitizeForLog(hit.value)}），本请求跳过全部频率桶（登录失败锁定不豁免）`,
      );
      return true;
    }

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
        if (result.retryAfter != null) {
          try {
            context
              .switchToHttp()
              .getResponse<{ setHeader(name: string, value: string): void }>()
              ?.setHeader("Retry-After", String(result.retryAfter));
          } catch {
          }
        }
        throw new NewApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
      }
    }
    return true;
  }
}

function extractRealIp(request: RequestWithUser): string | null {
  const header = request.headers["x-real-ip"];
  const raw = typeof header === "string" ? header.trim() : "";
  return raw.length > 0 ? raw : null;
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
  if (kind === "account" || kind === "phone") {
    const field = kind === "account" ? "username" : "phone";
    const value = (request.body as Record<string, unknown> | undefined)?.[field];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  const userId = request.user?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}
