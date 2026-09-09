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

    // 请求级豁免（IKEBOY 终审）：命中 IP / username 任一名单即整个请求跳过全部频率桶
    // （含 user 维度桶），不消耗 Redis 计数。IP 只认反向代理覆写的 `X-Real-IP`——
    // `X-Forwarded-For` 首值是 nginx 追加式透传、客户端可伪造，作为豁免凭证即送分题；
    // 缺该头按未命中处理（不回落 request.ip，nginx 部署下它是容器地址）。
    // 登录失败锁定（rlblock）不豁免：其封锁检查由 AuthController 在 guard 之外独立
    // 执行（isBlocked），不受本短路影响；限流桶自身的 take 取键行为（XFF 首值）不变。
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
        throw new NewApiError("操作过于频繁，请稍后再试", 429, RATE_LIMITED);
      }
    }
    return true;
  }
}

/** 豁免判定专用真实 IP：只认 nginx `$remote_addr` 覆写的 `X-Real-IP`，无兜底（IKEBOY）。 */
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
  if (kind === "account") {
    const username = (request.body as { username?: unknown } | undefined)?.username;
    return typeof username === "string" && username.trim() ? username.trim() : null;
  }
  const userId = request.user?.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}
