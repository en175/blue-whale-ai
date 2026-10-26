import { describe, expect, it, vi } from "vitest";

import {
  enforceRateLimit,
  extractRateLimitContext,
  type RateLimitContext,
} from "./rate-limit-policy.js";

function context(over: Partial<RateLimitContext> = {}): RateLimitContext {
  return {
    ip: "203.0.113.9",
    allowlistIp: null,
    account: null,
    phone: null,
    user: null,
    ...over,
  };
}

describe("extractRateLimitContext", () => {
  it("从请求头与请求体解析各维度 key", () => {
    expect(
      extractRateLimitContext({
        headers: {
          "x-forwarded-for": "203.0.113.9, 10.0.0.1",
          "x-real-ip": "203.0.113.9",
        },
        body: { username: "alice", phone: "13800001234" },
        user: { userId: "42" },
      }),
    ).toEqual({
      ip: "203.0.113.9",
      allowlistIp: "203.0.113.9",
      account: "alice",
      phone: "13800001234",
      user: "42",
    });
  });

  it("没有转发头时回退 request.ip", () => {
    expect(
      extractRateLimitContext({ headers: {}, ip: "127.0.0.1" }).ip,
    ).toBe("127.0.0.1");
  });
});

describe("enforceRateLimit", () => {
  const phoneBucket = {
    scope: "send_code_phone_minute",
    key: "phone" as const,
    limit: 1,
    windowMs: 60_000,
  };

  it("允许名单命中时跳过全部桶", async () => {
    const take = vi.fn();
    const decision = await enforceRateLimit(
      [phoneBucket],
      context({ phone: "13800001234", allowlistIp: "203.0.113.9" }),
      {
        limiter: { take } as never,
        allowlist: { isAllowed: () => true } as never,
      },
    );
    expect(decision).toEqual({
      allowed: true,
      allowlisted: { kind: "ip", value: "203.0.113.9" },
    });
    expect(take).not.toHaveBeenCalled();
  });

  it("从请求体字段取 key 并命中拒绝", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce({ allowed: false, retryAfter: 12 });
    const decision = await enforceRateLimit(
      [phoneBucket],
      context({ phone: "13800001234" }),
      {
        limiter: { take } as never,
        allowlist: { isAllowed: () => false } as never,
      },
    );
    expect(take).toHaveBeenCalledWith({
      scope: "send_code_phone_minute",
      key: "13800001234",
      limit: 1,
      windowMs: 60_000,
    });
    expect(decision).toEqual({ allowed: false, retryAfter: 12 });
  });

  it("缺少 key 的桶跳过；全部放行时返回 allowed", async () => {
    const take = vi.fn();
    const decision = await enforceRateLimit([phoneBucket], context(), {
      limiter: { take } as never,
      allowlist: { isAllowed: () => false } as never,
    });
    expect(decision).toEqual({ allowed: true });
    expect(take).not.toHaveBeenCalled();
  });
});
