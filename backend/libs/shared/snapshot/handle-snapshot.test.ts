import { describe, expect, it, vi } from "vitest";

import { handleGetSnapshot } from "./handle-snapshot.js";

// 快照 assets 是 Record<asset_id, SnapshotAssetSummary>，前端按 asset_id 取值渲染素材。
// md5 随行带出，老资产未落 md5 时为 null（不能缺字段，前端按 null 判「不可比对」）。

const PROJECT = {
  id: "523",
  name: "项目",
  thumb: null,
  created_at: "2026-09-17T00:00:00.000Z",
};

const CANVAS_VIEW = {
  id: "900",
  project_id: "523",
  version: 4,
  viewport: null,
  nodes: null,
  edges: null,
};

const MD5 = "d41d8cd98f00b204e9800998ecf8427e";

function buildDeps(assets: Array<Record<string, unknown>>) {
  return {
    projects: { findOwnedById: vi.fn().mockResolvedValue(PROJECT) },
    canvas: {
      migrateLegacyCards: vi
        .fn()
        .mockResolvedValue({ canvas: CANVAS_VIEW, report: { migrated: [], failed: [] } }),
    },
    snapshot: {
      loadJobsAndAssets: vi
        .fn()
        .mockResolvedValue({ generation_jobs: [], assets }),
      loadConversationState: vi.fn().mockResolvedValue({
        conversation_messages: [],
        plan_messages: [],
        scene_cards: [],
        plan_applications: [],
        scene_card_generation_records: [],
        storyboard_previews: [],
        high_watermark_cursor: "0",
      }),
    },
  } as never;
}

describe("handleGetSnapshot assets", () => {
  // IKEXX8/IKFYHJ 的 material_* 由各自的用例覆盖；这里只钉 md5，其余字段按未提供归 null。
  const untouchedMaterial = {
    material_id: null,
    material_group_id: null,
    material_status: null,
    material_status_checked_at: null,
  };

  it("素材列表带出 md5；未落 md5 的老资产为 null", async () => {
    const deps = buildDeps([
      { id: "3994", type: "image", url: "tos://a.png", md5: MD5, project_id: "523" },
      { id: "3995", type: "video", url: "tos://b.mp4", md5: null, project_id: "523" },
    ]);

    const result = await handleGetSnapshot("100", "523", deps);

    expect(result.code).toBe(200);
    expect(result.data?.assets).toEqual({
      "3994": {
        asset_id: "3994",
        access_url: "tos://a.png",
        type: "image",
        md5: MD5,
        ...untouchedMaterial,
      },
      "3995": {
        asset_id: "3995",
        access_url: "tos://b.mp4",
        type: "video",
        md5: null,
        ...untouchedMaterial,
      },
    });
  });

  it("无素材时 assets 为空对象", async () => {
    const result = await handleGetSnapshot("100", "523", buildDeps([]));

    expect(result.data?.assets).toEqual({});
  });
});
