import { describe, expect, it, vi } from "vitest";

import type { ReferenceItemInput } from "./reference-item-input.js";
import {
  localAssetReferenceIds,
  resolveReferenceDurations,
  videoAssetIdsNeedingDuration,
} from "./resolve-reference-durations.js";

function fakeAssets(
  byId: Record<string, { type?: string; duration?: number | null }>,
): { assets: { resolveInputAssets: (ids: string[]) => Promise<unknown[]> }; calls: string[][] } {
  const calls: string[][] = [];
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
  return { assets: { resolveInputAssets }, calls };
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

  it("duration 为 null/非正数 → 不回填（宁可量不到也不按 0 估）", async () => {
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
    expect(result).toMatchObject({
      kind: "resolved",
      references: refs2,
    });
  });
});
