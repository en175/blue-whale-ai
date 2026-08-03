import { describe, expect, it, vi } from "vitest";

import { handleListAssets } from "./handle-list-assets.js";

// GET /api/assets：当前用户资产库分页（type 过滤，创建时间倒序）。
// 对齐 Java AssetService.listAssets。

describe("handleListAssets", () => {
  it("按 userId + type 分页 → 200 + Paged<AssetView>", async () => {
    const item = {
      id: "7",
      type: "image",
      url: "https://x/7.png",
      width: 512,
      height: 512,
      duration: null,
      source: "generated",
      created_at: "2026-07-27T00:00:00.000Z",
    };
    const repo = {
      listByUser: vi.fn().mockResolvedValue({
        records: [item],
        total: 1,
        size: 24,
        current: 1,
      }),
    };
    const result = await handleListAssets(
      "9",
      { type: "image", page: 1, size: 24 },
      { assets: repo },
    );
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [item], total: 1, size: 24, current: 1 },
    });
    expect(repo.listByUser).toHaveBeenCalledWith("9", {
      type: "image",
      page: 1,
      size: 24,
    });
  });

  it("无 type → 全类型", async () => {
    const repo = {
      listByUser: vi
        .fn()
        .mockResolvedValue({ records: [], total: 0, size: 24, current: 1 }),
    };
    const result = await handleListAssets(
      "9",
      { page: 1, size: 24 },
      { assets: repo },
    );
    expect(result.code).toBe(200);
    expect(repo.listByUser).toHaveBeenCalledWith("9", {
      type: undefined,
      page: 1,
      size: 24,
    });
  });
});
