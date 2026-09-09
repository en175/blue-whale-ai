import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewApiError } from "@blue-whale/core";
import { RATE_LIMITED } from "@blue-whale/contracts";
import type { Request } from "express";
import { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitKey,
  type RateLimitOptions,
} from "./decorators/rate-limit.decorator.js";

type RequestWithUser = Request & { user?: { userId?: string } };

/** account key 是攻击者可控的请求体字段：截断 + 去换行，防日志注入与洪泛。 */
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
    for (const bucket of options.buckets) {
      const key = extractKey(request, bucket.key);
      if (!key) continue;
      // 白名单命中：跳过该桶且不消耗 Redis 计数。登录失败锁定（login_lock scope）
      // 由 AuthController 在 guard 之外独立检查，不受本短路影响。
      if (this.allowlist.isAllowed(bucket.key, key)) {
        this.logger.log(
          `限流白名单命中，跳过桶 ${bucket.scope}（key=${bucket.key}: ${sanitizeForLog(key)}）`,
        );
        continue;
      }
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
