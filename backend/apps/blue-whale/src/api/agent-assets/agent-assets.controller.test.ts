import { describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { RATE_LIMITED } from "@blue-whale/contracts";
import { RateLimitGuard } from "@lib/shared/rate-limit/rate-limit.guard.js";
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from "@lib/shared/rate-limit/decorators/rate-limit.decorator.js";
import { AgentAssetsController } from "./agent-assets.controller.js";

const reflector = new Reflector();

type Handler = (...args: never[]) => unknown;

function readBuckets(handler: Handler): RateLimitOptions | undefined {
  return reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
    handler,
    AgentAssetsController,
  ]);
}

/** 用真实 Reflector 读取控制器上的 @RateLimit 元数据跑 RateLimitGuard，RateLimiter 打桩。 */
function runGuard(handler: Handler, take: ReturnType<typeof vi.fn>, userId = "user-1") {
  const guard = new RateLimitGuard(reflector, { take } as never, {
    isAllowed: () => false,
  } as never);
  return guard.canActivate({
    getHandler: () => handler,
    getClass: () => AgentAssetsController,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, body: {}, user: { userId } }),
    }),
  } as never);
}

async function expectLimitedWith(handler: Handler, take: ReturnType<typeof vi.fn>) {
  await expect(runGuard(handler, take)).rejects.toMatchObject({
    status: 429,
    code: RATE_LIMITED,
  });
}

/** 工单 IKDR4P 口径：presign 与 uploads/presign 共享 asset-presign scope（30/min + 120/hr）。 */
const PRESIGN_BUCKETS = [
  { scope: "asset-presign", key: "user", limit: 30, windowMs: 60_000 },
  { scope: "asset-presign", key: "user", limit: 120, windowMs: 3_600_000 },
];

describe("AgentAssetsController 上传限流（IKDR4P）", () => {
  it("presign 声明用户维度 30 次/分钟 + 120 次/小时桶", () => {
    expect(readBuckets(AgentAssetsController.prototype.presign)?.buckets).toEqual(
      PRESIGN_BUCKETS,
    );
  });

  it("uploads/presign 与 presign 共享 asset-presign scope", () => {
    expect(readBuckets(AgentAssetsController.prototype.uploadsPresign)?.buckets).toEqual(
      PRESIGN_BUCKETS,
    );
  });

  it("uploads/dedup 声明用户维度 30 次/分钟桶", () => {
    expect(readBuckets(AgentAssetsController.prototype.uploadsDedup)?.buckets).toEqual([
      { scope: "asset-dedup", key: "user", limit: 30, windowMs: 60_000 },
    ]);
  });

  it("uploads/complete 声明用户维度 30 次/分钟桶", () => {
    expect(readBuckets(AgentAssetsController.prototype.uploadsComplete)?.buckets).toEqual([
      { scope: "asset-complete", key: "user", limit: 30, windowMs: 60_000 },
    ]);
  });

  it("presign 与 dedup/complete scope 分离（分开计数）", () => {
    const scopesOf = (handler: Handler) =>
      new Set(readBuckets(handler)?.buckets.map((b) => b.scope));
    const presignScopes = scopesOf(AgentAssetsController.prototype.presign);
    expect(presignScopes.has("asset-dedup")).toBe(false);
    expect(presignScopes.has("asset-complete")).toBe(false);
    expect(scopesOf(AgentAssetsController.prototype.uploadsDedup).has("asset-presign")).toBe(
      false,
    );
    expect(
      scopesOf(AgentAssetsController.prototype.uploadsComplete).has("asset-presign"),
    ).toBe(false);
  });

  it("presign 分钟级超限 → 429 + rate_limited", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 12 });
    await expectLimitedWith(AgentAssetsController.prototype.presign, take);
    expect(take).toHaveBeenCalledWith({
      scope: "asset-presign",
      key: "user-1",
      limit: 30,
      windowMs: 60_000,
    });
  });

  it("presign 小时级配额超限 → 429 + rate_limited", async () => {
    const take = vi
      .fn()
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfter: 1200 });
    await expectLimitedWith(AgentAssetsController.prototype.presign, take);
    expect(take).toHaveBeenNthCalledWith(2, {
      scope: "asset-presign",
      key: "user-1",
      limit: 120,
      windowMs: 3_600_000,
    });
  });

  it("uploads/dedup 超限 → 429 + rate_limited", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 30 });
    await expectLimitedWith(AgentAssetsController.prototype.uploadsDedup, take);
    expect(take).toHaveBeenCalledWith({
      scope: "asset-dedup",
      key: "user-1",
      limit: 30,
      windowMs: 60_000,
    });
  });

  it("uploads/complete 超限 → 429 + rate_limited", async () => {
    const take = vi.fn().mockResolvedValue({ allowed: false, retryAfter: 30 });
    await expectLimitedWith(AgentAssetsController.prototype.uploadsComplete, take);
    expect(take).toHaveBeenCalledWith({
      scope: "asset-complete",
      key: "user-1",
      limit: 30,
      windowMs: 60_000,
    });
  });
});
