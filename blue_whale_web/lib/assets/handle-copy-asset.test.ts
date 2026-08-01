import { describe, expect, it, vi } from "vitest";

import {
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
} from "@blue-whale/contracts";
import type {
  AssetRepo,
  AssetSourceFields,
  ProjectRepo,
} from "@blue-whale/persistence";

import { handleCopyAsset } from "./handle-copy-asset.js";

// POST /api/projects/{projectId}/assets：跨项目复制资产（「添加到项目」）。
// 对齐 Java AssetCopyService.copyToProject：body.source_asset_id + Idempotency-Key（必传）。
// 归属/状态/存在性不满足统一返 100301（不泄漏存在性）。

const source: AssetSourceFields = {
  type: "image",
  storage_key: "gen/sha256/abc.png",
  url: "/assets/9/content",
  mime: "image/png",
  size: BigInt(1024),
  width: 512,
  height: 512,
  duration: null,
  source: "generated",
};

const copy = {
  id: "101",
  type: "image",
  url: "/assets/101/content",
  width: 512,
  height: 512,
  duration: null,
  source: "generated",
  created_at: "2026-07-27T10:00:00.000Z",
};

function makeDeps(
  overrides: {
    project?: Partial<ProjectRepo>;
    assets?: Partial<AssetRepo>;
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
      findOwnedSource: vi.fn().mockResolvedValue(source),
      insertCopy: vi.fn().mockResolvedValue(copy),
      ...overrides.assets,
    } as unknown as AssetRepo,
  };
}

describe("handleCopyAsset", () => {
  it("缺 Idempotency-Key → 100000", async () => {
    const deps = makeDeps();
    const result = await handleCopyAsset(
      "9",
      "5",
      { source_asset_id: 9 },
      "",
      deps,
    );
    expect(result).toEqual({
      code: PARAM_MISSING_CODE,
      msg: "缺少 Idempotency-Key",
      data: null,
    });
    expect(deps.assets.insertCopy).not.toHaveBeenCalled();
  });

  it("目标项目不归属当前用户 → 100301（不泄漏存在性）", async () => {
    const deps = makeDeps({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await handleCopyAsset(
      "9",
      "5",
      { source_asset_id: 9 },
      "cmd-1",
      deps,
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.assets.findOwnedSource).not.toHaveBeenCalled();
  });

  it("源资产不存在/不归属/非正常 → 100301", async () => {
    const deps = makeDeps({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await handleCopyAsset(
      "9",
      "5",
      { source_asset_id: 9 },
      "cmd-1",
      deps,
    );
    expect(result.code).toBe(RESOURCE_NOT_FOUND_CODE);
    expect(deps.assets.insertCopy).not.toHaveBeenCalled();
  });

  it("成功 → 200 + 副本 AssetView，insertCopy 透传源字段", async () => {
    const deps = makeDeps();
    const result = await handleCopyAsset(
      "9",
      "5",
      { source_asset_id: 9 },
      "cmd-1",
      deps,
    );
    expect(result).toEqual({ code: 200, msg: null, data: copy });
    expect(deps.project.findOwnedById).toHaveBeenCalledWith("5", "9");
    expect(deps.assets.findOwnedSource).toHaveBeenCalledWith("9", "9");
    expect(deps.assets.insertCopy).toHaveBeenCalledWith("5", "9", source);
  });

  it("source_asset_id 缺失 → 100000（参数缺失）", async () => {
    const deps = makeDeps();
    const result = await handleCopyAsset("9", "5", {}, "cmd-1", deps);
    expect(result.code).toBe(PARAM_MISSING_CODE);
    expect(deps.assets.insertCopy).not.toHaveBeenCalled();
  });
});
