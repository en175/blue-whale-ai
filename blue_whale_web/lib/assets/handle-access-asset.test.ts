import { describe, expect, it, vi } from "vitest";

import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type { AssetRepo, ProjectRepo } from "@blue-whale/persistence";

import { handleAccessAsset } from "./handle-access-asset.js";
import type { AssetSigner } from "./ports.js";

// GET /api/projects/{projectId}/assets/{assetId}：签发短期可访问 URL。
// 对齐 Java ProjectAssetAccessService.sign → AssetAccessResponse { url, expires_at }。

function makeDeps(overrides: {
  project?: Partial<ProjectRepo>;
  assets?: Partial<AssetRepo>;
  signer?: AssetSigner | null;
} = {}) {
  return {
    project: {
      findOwnedById: vi.fn().mockResolvedValue({ id: "5", name: "p", thumb: null, created_at: "x" }),
      ...overrides.project,
    } as unknown as ProjectRepo,
    assets: {
      findAccessible: vi
        .fn()
        .mockResolvedValue({ storage_key: "gen/sha256/abc.png", mime: "image/png" }),
      ...overrides.assets,
    } as unknown as AssetRepo,
    signer:
      overrides.signer === undefined
        ? ({
            sign: vi.fn().mockResolvedValue({
              url: "https://tos/abc?signed=1",
              expiresAt: new Date("2026-07-27T12:10:00.000Z"),
            }),
          } as unknown as AssetSigner)
        : overrides.signer,
  };
}

describe("handleAccessAsset", () => {
  it("项目不归属 → 100301", async () => {
    const deps = makeDeps({ project: { findOwnedById: vi.fn().mockResolvedValue(null) } });
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.assets.findAccessible).not.toHaveBeenCalled();
  });

  it("资产不存在/不归属 → 100301", async () => {
    const deps = makeDeps({ assets: { findAccessible: vi.fn().mockResolvedValue(null) } });
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
  });

  it("storage_key 为空 → 100202 资源不可用", async () => {
    const deps = makeDeps({
      assets: { findAccessible: vi.fn().mockResolvedValue({ storage_key: null, mime: null }) },
    });
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("未配置 signer → 100202（对齐 Java signer==null）", async () => {
    const deps = makeDeps({ signer: null });
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("signer 抛错 → 100202", async () => {
    const deps = makeDeps({
      signer: { sign: vi.fn().mockRejectedValue(new Error("tos down")) } as unknown as AssetSigner,
    });
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result.code).toBe(ASSET_UNAVAILABLE_CODE);
  });

  it("成功 → 200 + {url, expires_at}（ISO 字符串，snake_case）", async () => {
    const deps = makeDeps();
    const result = await handleAccessAsset("9", "5", "101", deps);
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { url: "https://tos/abc?signed=1", expires_at: "2026-07-27T12:10:00.000Z" },
    });
    expect(deps.assets.findAccessible).toHaveBeenCalledWith("5", "101", "9");
    expect(deps.signer!.sign).toHaveBeenCalledWith("gen/sha256/abc.png");
  });
});
