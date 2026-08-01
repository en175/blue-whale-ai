import { describe, expect, it, vi } from "vitest";

import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { AssetRepo, ProjectRepo } from "@blue-whale/persistence";

import { handleContentAsset } from "./handle-content-asset.js";
import type { AssetReader } from "./ports.js";

// GET /api/projects/{projectId}/assets/{assetId}/content：返回原始字节（content-type + body）。
// 对齐 Java ProjectAssetContentService.read → AssetContent(content, mime) → ResponseEntity<byte[]>。
// 注意：该端点不走 {code,msg,data} 信封，成功直接返字节；失败才返信封。故 handler 用判别联合。

function makeDeps(
  overrides: {
    project?: Partial<ProjectRepo>;
    assets?: Partial<AssetRepo>;
    reader?: AssetReader | null;
  } = {},
) {
  return {
    project: {
      findOwnedById: vi.fn().mockResolvedValue({
        id: "5",
        name: "p",
        thumb: null,
        created_at: "x",
      }),
      ...overrides.project,
    } as unknown as ProjectRepo,
    assets: {
      findAccessible: vi.fn().mockResolvedValue({
        storage_key: "gen/sha256/abc.png",
        mime: "image/png",
      }),
      ...overrides.assets,
    } as unknown as AssetRepo,
    reader:
      overrides.reader === undefined
        ? ({
            read: vi
              .fn()
              .mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
          } as unknown as AssetReader)
        : overrides.reader,
  };
}

describe("handleContentAsset", () => {
  it("项目不归属 → fail 100301", async () => {
    const deps = makeDeps({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("资产不存在/不归属 → fail 100301", async () => {
    const deps = makeDeps({
      assets: { findAccessible: vi.fn().mockResolvedValue(null) },
    });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("storage_key 为空 → fail 100202", async () => {
    const deps = makeDeps({
      assets: {
        findAccessible: vi
          .fn()
          .mockResolvedValue({ storage_key: "", mime: null }),
      },
    });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("未配置 reader → fail 100202", async () => {
    const deps = makeDeps({ reader: null });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("reader 抛错 → fail 100202", async () => {
    const deps = makeDeps({
      reader: {
        read: vi.fn().mockRejectedValue(new Error("tos down")),
      } as unknown as AssetReader,
    });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("成功 → ok 字节 + asset.mime 作 content-type", async () => {
    const deps = makeDeps();
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result).toEqual({
      ok: true,
      content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mime: "image/png",
    });
    expect(deps.reader!.read).toHaveBeenCalledWith("gen/sha256/abc.png");
  });

  it("mime 缺失 → 兜底 application/octet-stream", async () => {
    const deps = makeDeps({
      assets: {
        findAccessible: vi
          .fn()
          .mockResolvedValue({ storage_key: "k", mime: null }),
      },
    });
    const result = await handleContentAsset("9", "5", "101", deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe("application/octet-stream");
  });
});
