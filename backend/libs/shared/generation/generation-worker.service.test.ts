import { describe, expect, it, vi } from "vitest";

import { retryConsumeQuotaLookup } from "./generation-worker.service.js";

describe("retryConsumeQuotaLookup（IK9VZ0 图片流水查询短重试）", () => {
  it("首次查不到（null）二次成功 → 只返回一次真实 quota，lookup 调用 2 次", async () => {
    const lookup = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(880000);
    const quota = await retryConsumeQuotaLookup(lookup, "req-1", 3, 1);
    expect(quota).toBe(880000);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("查询抛错后成功 → 返回 quota（异常不阻断重试）", async () => {
    const lookup = vi
      .fn<() => Promise<number | null>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(500000);
    const quota = await retryConsumeQuotaLookup(lookup, "req-2", 3, 1);
    expect(quota).toBe(500000);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("始终查不到 → 重试满 attempts 次后返回 null（上层走取证失败告警）", async () => {
    const lookup = vi.fn<() => Promise<number | null>>().mockResolvedValue(null);
    const quota = await retryConsumeQuotaLookup(lookup, "req-3", 3, 1);
    expect(quota).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("查到的 quota 为 0 → 视为异常重试，最终返回 0（上层 quota≤0 告警）", async () => {
    const lookup = vi.fn<() => Promise<number | null>>().mockResolvedValue(0);
    const quota = await retryConsumeQuotaLookup(lookup, "req-4", 2, 1);
    expect(quota).toBe(0);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
