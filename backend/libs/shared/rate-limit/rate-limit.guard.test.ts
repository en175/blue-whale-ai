import { describe, expect, it, vi } from "vitest";
import { RATE_LIMITED } from "@blue-whale/contracts";
import { RateLimitGuard } from "./rate-limit.guard.js";
import type { RateLimitOptions } from "./decorators/rate-limit.decorator.js";

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
});
