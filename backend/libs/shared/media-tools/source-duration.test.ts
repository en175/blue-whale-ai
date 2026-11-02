import { describe, expect, it, vi } from "vitest";

vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { resolveSourceDuration } from "./source-duration.js";

function makeArgs(overrides: Record<string, unknown> = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { user_assets: { updateMany } };
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

describe("resolveSourceDuration", () => {
  it("库里有值 → 四舍五入到秒，不探测", async () => {
    const { args, storage } = makeArgs({
      asset: { id: "88", storage_key: "k", duration_ms: 10_600 },
    });
    await expect(resolveSourceDuration(args as never)).resolves.toEqual({
      seconds: 11,
      durationMs: 10_600,
      width: null,
      height: null,
    });
    expect(storage.probe).not.toHaveBeenCalled();
  });

  it("库里缺失 → 探测一次并回填", async () => {
    const { args, storage, updateMany } = makeArgs();
    storage.probe.mockResolvedValue({
      durationMs: 65_000,
      width: 1080,
      height: 1920,
    });
    await expect(resolveSourceDuration(args as never)).resolves.toEqual({
      seconds: 65,
      durationMs: 65_000,
      width: 1080,
      height: 1920,
    });
    expect(storage.probe).toHaveBeenCalledWith("uploads/9/video/a.mp4");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration_ms: 65_000, width: 1080 }),
      }),
    );
  });

  it("有库内时长但缺尺寸 → 需要尺寸时探测补齐，保留库内时长", async () => {
    const { args, storage } = makeArgs({
      asset: {
        id: "88",
        storage_key: "uploads/9/video/a.mp4",
        duration_ms: 10_000,
        width: null,
        height: null,
      },
      probeDimensions: true,
    });
    storage.probe.mockResolvedValue({
      durationMs: 12_000,
      width: 1920,
      height: 1080,
    });
    await expect(resolveSourceDuration(args as never)).resolves.toEqual({
      seconds: 10,
      durationMs: 10_000,
      width: 1920,
      height: 1080,
    });
  });

  it("补尺寸探测失败 → 保留库内时长，不阻断", async () => {
    const { args, storage } = makeArgs({
      asset: {
        id: "88",
        storage_key: "uploads/9/video/a.mp4",
        duration_ms: 10_000,
        width: null,
        height: null,
      },
      probeDimensions: true,
    });
    storage.probe.mockRejectedValue(new Error("tos down"));
    await expect(resolveSourceDuration(args as never)).resolves.toEqual({
      seconds: 10,
      durationMs: 10_000,
      width: null,
      height: null,
    });
  });

  it("不足 1 秒按 1 秒计", async () => {
    const { args } = makeArgs({
      asset: { id: "88", storage_key: "k", duration_ms: 400 },
    });
    await expect(resolveSourceDuration(args as never)).resolves.toEqual({
      seconds: 1,
      durationMs: 400,
      width: null,
      height: null,
    });
  });

  it("secondsPolicy=floor：4.9 秒取 4，5 秒档不越档", async () => {
    const { args } = makeArgs({
      asset: { id: "88", storage_key: "k", duration_ms: 4_900 },
      secondsPolicy: "floor",
    });
    await expect(resolveSourceDuration(args as never)).resolves.toMatchObject({
      seconds: 4,
    });
  });

  it("默认仍四舍五入：4.9 秒取 5", async () => {
    const { args } = makeArgs({
      asset: { id: "88", storage_key: "k", duration_ms: 4_900 },
    });
    await expect(resolveSourceDuration(args as never)).resolves.toMatchObject({
      seconds: 5,
    });
  });

  it("没有存储键或探测失败 → null（调用方拒绝提交）", async () => {
    const { args, storage } = makeArgs({
      asset: { id: "88", storage_key: null, duration_ms: null },
    });
    await expect(resolveSourceDuration(args as never)).resolves.toBeNull();
    expect(storage.probe).not.toHaveBeenCalled();

    const second = makeArgs();
    second.storage.probe.mockRejectedValue(new Error("tos down"));
    await expect(
      resolveSourceDuration(second.args as never),
    ).resolves.toBeNull();
  });

  it("探测不到有效时长 → null", async () => {
    const { args, storage } = makeArgs();
    storage.probe.mockResolvedValue({ durationMs: 0, width: null, height: null });
    await expect(resolveSourceDuration(args as never)).resolves.toBeNull();
  });
});
