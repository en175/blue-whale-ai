import { afterEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMITED } from "@blue-whale/contracts";
import { RateLimitAllowlist } from "./rate-limit-allowlist.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import type { RateLimitOptions } from "./decorators/rate-limit.decorator.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeContext(request: Record<string, unknown>) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  };
}

describe("RateLimitGuard", () => {
  it("allows routes without @RateLimit metadata", async () => {
    const take = vi.fn();
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => undefined } as never,
      { take } as never,
      { isAllowed: () => false } as never,
    );
    await expect(guard.canActivate(makeContext({}) as never)).resolves.toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("takes ip then account buckets and throws 429 when limited", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfter: 2 });
    const options: RateLimitOptions = {
      buckets: [
        { scope: "login", key: "ip", limit: 20, windowMs: 60_000 },
        { scope: "login", key: "account", limit: 5, windowMs: 60_000 },
      ],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: () => false } as never,
    );
    const context = makeContext({
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      body: { username: "alice" },
      ip: "127.0.0.1",
    });
    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: 429,
      code: RATE_LIMITED,
      message: "操作过于频繁，请稍后再试",
    });
    expect(take).toHaveBeenNthCalledWith(1, {
      scope: "login",
      key: "203.0.113.9",
      limit: 20,
      windowMs: 60_000,
    });
    expect(take).toHaveBeenNthCalledWith(2, {
      scope: "login",
      key: "alice",
      limit: 5,
      windowMs: 60_000,
    });
  });

  it("skips a bucket when the key cannot be extracted", async () => {
    const take = vi.fn();
    const options: RateLimitOptions = {
      buckets: [{ scope: "login", key: "user", limit: 5, windowMs: 1000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: () => false } as never,
    );
    await expect(
      guard.canActivate(makeContext({ headers: {}, body: {} }) as never),
    ).resolves.toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("falls back to request.ip when X-Forwarded-For is blank", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: true });
    const options: RateLimitOptions = {
      buckets: [{ scope: "login", key: "ip", limit: 20, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: () => false } as never,
    );
    await expect(
      guard.canActivate(
        makeContext({
          headers: { "x-forwarded-for": "  " },
          ip: "127.0.0.1",
        }) as never,
      ),
    ).resolves.toBe(true);
    expect(take).toHaveBeenCalledWith({
      scope: "login",
      key: "127.0.0.1",
      limit: 20,
      windowMs: 60_000,
    });
  });

  it("exempts the whole request once any allowlist hits (request-level)", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 3 });
    const options: RateLimitOptions = {
      buckets: [
        { scope: "login_ip", key: "ip", limit: 20, windowMs: 60_000 },
        { scope: "login_account", key: "account", limit: 5, windowMs: 60_000 },
      ],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: (kind: string) => kind === "ip" } as never,
    );
    const context = makeContext({
      headers: { "x-real-ip": "203.0.113.9" },
      body: { username: "alice" },
    });
    // IP 命中即整请求豁免：account 桶也不计数、不 429
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("user-keyed buckets are exempted by the request-level hit", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 1 });
    const options: RateLimitOptions = {
      buckets: [{ scope: "asset-presign", key: "user", limit: 30, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: (kind: string) => kind === "ip" } as never,
    );
    const context = makeContext({
      headers: { "x-real-ip": "203.0.113.9" },
      body: {},
      user: { userId: "12345" },
    });
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("without any allowlist hit all buckets still consume counts", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 1 });
    const options: RateLimitOptions = {
      buckets: [{ scope: "login_ip", key: "ip", limit: 20, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      { isAllowed: () => false } as never,
    );
    await expect(
      guard.canActivate(
        makeContext({
          headers: { "x-real-ip": "198.51.100.7" },
          body: {},
          ip: "198.51.100.7",
        }) as never,
      ),
    ).rejects.toMatchObject({ status: 429, code: RATE_LIMITED });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("exempts a whitelisted IP end-to-end with the real allowlist (wiring check)", async () => {
    // 不打桩 isAllowed：用真实 RateLimitAllowlist 接进 guard，钉住 X-Real-IP 取键接线
    vi.stubEnv("RATE_LIMIT_ALLOW_IPS", "203.0.113.0/24");
    vi.stubEnv("RATE_LIMIT_ALLOW_ACCOUNTS", "");
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 1 });
    const options: RateLimitOptions = {
      buckets: [{ scope: "login_ip", key: "ip", limit: 20, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      new RateLimitAllowlist(),
    );
    await expect(
      guard.canActivate(
        makeContext({ headers: { "x-real-ip": "203.0.113.9" } }) as never,
      ),
    ).resolves.toBe(true);
    expect(take).not.toHaveBeenCalled();
  });

  it("rejects X-Forwarded-For spoofing: whitelist only honors X-Real-IP", async () => {
    vi.stubEnv("RATE_LIMIT_ALLOW_IPS", "203.0.113.0/24");
    vi.stubEnv("RATE_LIMIT_ALLOW_ACCOUNTS", "");
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 1 });
    const options: RateLimitOptions = {
      buckets: [{ scope: "login_ip", key: "ip", limit: 20, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      new RateLimitAllowlist(),
    );
    // 客户端伪造 XFF 首值 + 真实连接 IP 不在名单：不豁免
    await expect(
      guard.canActivate(
        makeContext({
          headers: {
            "x-forwarded-for": "203.0.113.9, 10.0.0.1",
            "x-real-ip": "198.51.100.7",
          },
          body: {},
        }) as never,
      ),
    ).rejects.toMatchObject({ status: 429, code: RATE_LIMITED });
    // 缺 X-Real-IP（如本地直连）同样按未命中处理，不回落 request.ip
    await expect(
      guard.canActivate(
        makeContext({
          headers: { "x-forwarded-for": "203.0.113.9" },
          body: {},
          ip: "203.0.113.9",
        }) as never,
      ),
    ).rejects.toMatchObject({ status: 429, code: RATE_LIMITED });
    expect(take).toHaveBeenCalledTimes(2);
  });

  it("still limits a non-whitelisted IP end-to-end with the real allowlist", async () => {
    vi.stubEnv("RATE_LIMIT_ALLOW_IPS", "203.0.113.0/24");
    vi.stubEnv("RATE_LIMIT_ALLOW_ACCOUNTS", "");
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 1 });
    const options: RateLimitOptions = {
      buckets: [{ scope: "login_ip", key: "ip", limit: 20, windowMs: 60_000 }],
    };
    const guard = new RateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { take } as never,
      new RateLimitAllowlist(),
    );
    await expect(
      guard.canActivate(
        makeContext({
          headers: { "x-real-ip": "203.0.114.9" },
          body: {},
          ip: "203.0.114.9",
        }) as never,
      ),
    ).rejects.toMatchObject({ status: 429, code: RATE_LIMITED });
    expect(take).toHaveBeenCalledTimes(1);
  });
});
