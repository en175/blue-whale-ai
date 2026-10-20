import { describe, expect, it, vi } from "vitest";

import type { ReferenceItemInput } from "./reference-item-input.js";
import {
  localAssetReferenceIds,
  resolveReferenceDurations,
  videoAssetIdsNeedingDuration,
} from "./resolve-reference-durations.js";

function fakeAssets(
  byId: Record<string, { type?: string; duration?: number | null }>,
  probeTargets: Record<string, string> = {},
): {
  assets: {
    resolveInputAssets: (ids: string[]) => Promise<unknown[]>;
    findStorageKeys: (ids: string[]) => Promise<Map<string, string>>;
    saveMediaInfo: (id: string, info: unknown) => Promise<boolean>;
  };
  calls: string[][];
  saved: Array<{ id: string; info: unknown }>;
} {
  const calls: string[][] = [];
  const saved: Array<{ id: string; info: unknown }> = [];
  const resolveInputAssets = vi.fn(async (ids: string[]) => {
    calls.push([...ids]);
    return ids.flatMap((id) =>
      id in byId
        ? [
            {
              id,
              type: byId[id]!.type ?? "video",
              url: `https://assets/${id}`,
              mime: null,
              size: null,
              width: null,
              height: null,
              duration: byId[id]!.duration ?? null,
              material_id: null,
            },
          ]
        : [],
    );
  });
  const findStorageKeys = vi.fn(async (ids: string[]) =>
    new Map(
      ids.flatMap((id) =>
        id in probeTargets ? [[id, probeTargets[id]!] as const] : [],
      ),
    ),
  );
  const saveMediaInfo = vi.fn(async (id: string, info: unknown) => {
    saved.push({ id, info });
    return true;
  });
  return {
    assets: { resolveInputAssets, findStorageKeys, saveMediaInfo },
    calls,
    saved,
  };
}

describe("videoAssetIdsNeedingDuration（报价面筛选）", () => {
  it("只取缺时长的本地视频引用，去重", () => {
    const refs: ReferenceItemInput[] = [
      { role: "reference", type: "video", asset_id: "7" },
      { role: "reference", type: "video", asset_id: "7" },
      { role: "reference", type: "video", asset_id: "8", duration: 3 },
      { role: "reference", type: "image", asset_id: "9" },
      { role: "reference", type: "video", material_id: "Asset-lib" },
    ];
    expect(videoAssetIdsNeedingDuration(refs)).toEqual(["7"]);
  });
});

describe("localAssetReferenceIds（建任务面筛选）", () => {
  it("取全部本地引用（不限媒体类型），去重", () => {
    const refs: ReferenceItemInput[] = [
      { role: "reference", type: "video", asset_id: "7" },
      { role: "reference", type: "image", asset_id: "9" },
      { role: "reference", type: "video", asset_id: "7" },
      { role: "reference", type: "video", material_id: "Asset-lib" },
      { role: "first_frame", type: "image", asset_id: "11" },
    ];
    expect(localAssetReferenceIds(refs)).toEqual(["7", "9", "11"]);
  });
});

describe("resolveReferenceDurations（共享管线）", () => {
  const refs: ReferenceItemInput[] = [
    { role: "reference", type: "video", asset_id: "7" },
    { role: "reference", type: "video", asset_id: "8", duration: 3 },
    { role: "reference", type: "image", asset_id: "9" },
  ];

  it("数齐 → resolved：缺时长视频条目按 assets.duration 回填，其余原样", async () => {
    const { assets } = fakeAssets({ "7": { duration: 13.5 }, "8": { duration: 99 }, "9": { type: "image" } });
    const result = await resolveReferenceDurations({
      references: refs,
      assetIdsOf: localAssetReferenceIds,
      userId: "42",
      projectId: "1",
      assets,
    });
    expect(result).toEqual({
      kind: "resolved",
      references: [
        { role: "reference", type: "video", asset_id: "7", duration: 13.5 },
        { role: "reference", type: "video", asset_id: "8", duration: 3 },
        { role: "reference", type: "image", asset_id: "9" },
      ],
      assetsById: expect.any(Map),
    });
  });

  it("数不齐 → shortfall（判别交给调用方：建任务 400 / 报价回落）", async () => {
    const { assets } = fakeAssets({ "7": { duration: 13.5 } });
    const result = await resolveReferenceDurations({
      references: refs,
      assetIdsOf: localAssetReferenceIds,
      userId: "42",
      projectId: "1",
      assets,
    });
    expect(result).toEqual({ kind: "shortfall" });
  });

  it("筛选为空 → resolved 且不查库（无本地引用的请求行为不变）", async () => {
    const { assets, calls } = fakeAssets({});
    const result = await resolveReferenceDurations({
      references: [{ role: "reference", type: "video", material_id: "Asset-lib" }],
      assetIdsOf: videoAssetIdsNeedingDuration,
      userId: "42",
      projectId: "1",
      assets,
    });
    expect(result.kind).toBe("resolved");
    expect(calls).toEqual([]);
  });

  it("duration 为 null/非正数且无探测能力 → probe_failed（不按 0 估，也不放行）", async () => {
    const refs2: ReferenceItemInput[] = [
      { role: "reference", type: "video", asset_id: "7" },
      { role: "reference", type: "video", asset_id: "8" },
    ];
    const { assets } = fakeAssets({ "7": { duration: null }, "8": { duration: 0 } });
    const result = await resolveReferenceDurations({
      references: refs2,
      assetIdsOf: videoAssetIdsNeedingDuration,
      userId: "42",
      projectId: "1",
      assets,
    });
    expect(result).toEqual({ kind: "probe_failed" });
  });

  it("缺时长 → 探测一次、回填资产行，并用探测结果计费", async () => {
    const refs2: ReferenceItemInput[] = [
      { role: "reference", type: "video", asset_id: "7" },
    ];
    const { assets, saved } = fakeAssets({ "7": { duration: null } }, {
      "7": "uploads/42/video/a.mp4",
    });
    const probe = vi.fn().mockResolvedValue({
      sizeBytes: 100,
      durationMs: 6500,
      width: 1080,
      height: 1920,
      codec: "h264",
      container: "mp4",
      fps: 30,
    });
    const result = await resolveReferenceDurations({
      references: refs2,
      assetIdsOf: videoAssetIdsNeedingDuration,
      userId: "42",
      projectId: "1",
      assets,
      probe,
    });
    expect(probe).toHaveBeenCalledWith("uploads/42/video/a.mp4");
    expect(saved).toEqual([
      {
        id: "7",
        info: expect.objectContaining({ durationMs: 6500, width: 1080 }),
      },
    ]);
    expect(result).toMatchObject({
      kind: "resolved",
      references: [{ role: "reference", type: "video", asset_id: "7", duration: 6.5 }],
    });
  });

  it("探测失败 → probe_failed，调用方拒绝提交", async () => {
    const refs2: ReferenceItemInput[] = [
      { role: "reference", type: "video", asset_id: "7" },
    ];
    const { assets } = fakeAssets({ "7": { duration: null } }, {
      "7": "uploads/42/video/a.mp4",
    });
    const result = await resolveReferenceDurations({
      references: refs2,
      assetIdsOf: videoAssetIdsNeedingDuration,
      userId: "42",
      projectId: "1",
      assets,
      probe: vi.fn().mockRejectedValue(new Error("tos down")),
    });
    expect(result).toEqual({ kind: "probe_failed" });
  });
});
