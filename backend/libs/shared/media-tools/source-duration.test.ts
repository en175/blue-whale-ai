import { describe, expect, it, vi } from "vitest";

vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { resolveSourceDurationSeconds } from "./source-duration.js";

function makeArgs(overrides: Record<string, unknown> = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { assets: { updateMany } };
  const storage = { probe: vi.fn() };
  return {
    args: {
      prisma,
      storage,
      asset: { id: "88", storage_key: "uploads/9/video/a.mp4", duration_ms: null },
      ...overrides,
    },
    updateMany,
    storage,
  };
}

describe("resolveSourceDurationSeconds", () => {
  it("库里有值 → 四舍五入到秒，不探测", async () => {
    const { args, storage } = makeArgs({
      asset: { id: "88", storage_key: "k", duration_ms: 10_600 },
    });
    await expect(resolveSourceDurationSeconds(args as never)).resolves.toBe(11);
    expect(storage.probe).not.toHaveBeenCalled();
  });

  it("库里缺失 → 探测一次并回填", async () => {
    const { args, storage, updateMany } = makeArgs();
    storage.probe.mockResolvedValue({
      durationMs: 65_000,
      width: 1080,
      height: 1920,
    });
    await expect(resolveSourceDurationSeconds(args as never)).resolves.toBe(65);
    expect(storage.probe).toHaveBeenCalledWith("uploads/9/video/a.mp4");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration_ms: 65_000, width: 1080 }),
      }),
    );
  });

  it("没有存储键或探测失败 → null（调用方拒绝提交）", async () => {
    const { args, storage } = makeArgs({
      asset: { id: "88", storage_key: null, duration_ms: null },
    });
    await expect(resolveSourceDurationSeconds(args as never)).resolves.toBeNull();
    expect(storage.probe).not.toHaveBeenCalled();

    const second = makeArgs();
    second.storage.probe.mockRejectedValue(new Error("tos down"));
    await expect(
      resolveSourceDurationSeconds(second.args as never),
    ).resolves.toBeNull();
  });

  it("探测不到有效时长 → null", async () => {
    const { args, storage } = makeArgs();
    storage.probe.mockResolvedValue({ durationMs: 0, width: null, height: null });
    await expect(resolveSourceDurationSeconds(args as never)).resolves.toBeNull();
  });
});
