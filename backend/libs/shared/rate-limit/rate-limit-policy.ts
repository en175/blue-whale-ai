import type { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import type { RateLimiter } from "./rate-limiter.js";
import type {
  RateLimitBucket,
  RateLimitKey,
} from "./decorators/rate-limit.decorator.js";

export interface RateLimitContext {
  ip: string | null;
  allowlistIp: string | null;
  account: string | null;
  phone: string | null;
  user: string | null;
}

export interface RateLimitRequestLike {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown | undefined;
  ip?: string | undefined;
  user?: { userId?: string | undefined } | undefined;
}

export type RateLimitDecision =
  | { allowed: true; allowlisted?: { kind: RateLimitKey; value: string } }
  | { allowed: false; retryAfter?: number };

function headerValue(
  headers: RateLimitRequestLike["headers"],
  name: string,
): string {
  const value = headers[name];
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return "";
}

function bodyField(request: RateLimitRequestLike, field: string): string | null {
  const value = (request.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractRateLimitContext(
  request: RateLimitRequestLike,
): RateLimitContext {
  const forwarded = headerValue(request.headers, "x-forwarded-for")
    .split(",")[0]
    ?.trim();
  const realIp = headerValue(request.headers, "x-real-ip");
  const userId = request.user?.userId;
  return {
    ip: forwarded || (request.ip && request.ip.length > 0 ? request.ip : null),
    allowlistIp: realIp.length > 0 ? realIp : null,
    account: bodyField(request, "username"),
    phone: bodyField(request, "phone"),
    user: typeof userId === "string" && userId.length > 0 ? userId : null,
  };
}

export async function enforceRateLimit(
  buckets: readonly RateLimitBucket[],
  context: RateLimitContext,
  deps: { limiter: Pick<RateLimiter, "take">; allowlist: RateLimitAllowlist },
): Promise<RateLimitDecision> {
  if (context.allowlistIp && deps.allowlist.isAllowed("ip", context.allowlistIp)) {
    return {
      allowed: true,
      allowlisted: { kind: "ip", value: context.allowlistIp },
    };
  }
  if (context.account && deps.allowlist.isAllowed("account", context.account)) {
    return {
      allowed: true,
      allowlisted: { kind: "account", value: context.account },
    };
  }
  for (const bucket of buckets) {
    const key = context[bucket.key];
    if (!key) continue;
    const result = await deps.limiter.take({
      scope: bucket.scope,
      key,
      limit: bucket.limit,
      windowMs: bucket.windowMs,
    });
    if (!result.allowed) {
      return result.retryAfter != null
        ? { allowed: false, retryAfter: result.retryAfter }
        : { allowed: false };
    }
  }
  return { allowed: true };
}
