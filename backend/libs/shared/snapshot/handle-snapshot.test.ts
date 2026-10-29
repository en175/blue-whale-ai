import { describe, expect, it, vi } from "vitest";

import { handleGetSnapshot } from "./handle-snapshot.js";


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
      getByProject: vi.fn().mockResolvedValue(CANVAS_VIEW),
    },
    snapshot: {
      loadJobsAndAssets: vi
        .fn()
        .mockResolvedValue({ generation_jobs: [], assets }),
      loadConversationState: vi.fn().mockResolvedValue({
        conversation_messages: [],
        scene_cards: [],
        scene_card_generation_records: [],
        storyboard_previews: [],
      }),
    },
  } as never;
}

describe("handleGetSnapshot assets", () => {
  it("素材列表带出 md5；未落 md5 的老资产为 null", async () => {
    const deps = buildDeps([
      { id: "3994", type: "image", url: "tos://a.png", md5: MD5, project_id: "523" },
      { id: "3995", type: "video", url: "tos://b.mp4", md5: null, project_id: "523" },
    ]);

    const result = await handleGetSnapshot("100", "523", deps);

    expect(result.code).toBe(200);
    expect(Object.keys(result.data?.assets ?? {})).toEqual(["3994", "3995"]);
    expect(result.data?.assets["3994"]).toMatchObject({
      asset_id: "3994",
      access_url: "tos://a.png",
      type: "image",
      md5: MD5,
    });
    expect(result.data?.assets["3995"]).toMatchObject({
      asset_id: "3995",
      access_url: "tos://b.mp4",
      type: "video",
      md5: null,
    });
  });

  it("无素材时 assets 为空对象", async () => {
    const result = await handleGetSnapshot("100", "523", buildDeps([]));

    expect(result.data?.assets).toEqual({});
  });
});
