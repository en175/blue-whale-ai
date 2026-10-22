import { CanActivate, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "@lib/core";
import { RATE_LIMITED } from "@lib/contracts";
import type { Request } from "express";
import { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  enforceRateLimit,
  extractRateLimitContext,
} from "./rate-limit-policy.js";
import {
  RATE_LIMIT_KEY,
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
    const decision = await enforceRateLimit(
      options.buckets,
      extractRateLimitContext(request),
      { limiter: this.limiter, allowlist: this.allowlist },
    );
    if (decision.allowed && decision.allowlisted) {
      this.logger.log(
        `限流豁免名单命中（${decision.allowlisted.kind}: ${sanitizeForLog(
          decision.allowlisted.value,
        )}），本请求跳过全部频率桶（登录失败锁定不豁免）`,
      );
    }
    if (!decision.allowed) {
      if (decision.retryAfter != null) {
        try {
          context
            .switchToHttp()
            .getResponse<{ setHeader(name: string, value: string): void }>()
            ?.setHeader("Retry-After", String(decision.retryAfter));
        } catch {
        }
      }
      throw new ApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
    }
    return true;
  }
}

