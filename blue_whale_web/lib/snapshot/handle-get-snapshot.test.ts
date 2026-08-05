import { describe, expect, it, vi } from "vitest";

import {
  applySnapshot,
  initialProjectRecoveryState,
  type ProjectSnapshot,
} from "../project-recovery";
import { assetAccessUrl, handleGetSnapshot } from "./handle-get-snapshot.js";

const sampleProject = {
  id: "7",
  name: "我的画布",
  thumb: null,
  created_at: "2026-07-27T00:00:00.000Z",
};
const sampleCanvas = {
  id: "3",
  project_id: "7",
  viewport: null,
  nodes: null,
};

function makeProjectRepo(view: typeof sampleProject | null = sampleProject) {
  return { findOwnedById: vi.fn().mockResolvedValue(view) };
}
function makeCanvasRepo() {
  return { getByProject: vi.fn().mockResolvedValue(sampleCanvas) };
}

describe("handleGetSnapshot 归属校验", () => {
  it("项目不存在/无权 → 100301 且不读聚合", async () => {
    const projects = { findOwnedById: vi.fn().mockResolvedValue(null) };
    const canvas = makeCanvasRepo();
    const snapshot = {
      loadJobsAndAssets: vi
        .fn()
        .mockResolvedValue({ generation_jobs: [], assets: [] }),
      loadConversationState: vi.fn(),
    };

    const res = await handleGetSnapshot("9", "7", {
      projects,
      canvas,
      snapshot,
    });

    expect(res).toEqual({ code: 100301, msg: "资源不存在", data: null });
    expect(projects.findOwnedById).toHaveBeenCalledWith("7", "9");
    expect(canvas.getByProject).not.toHaveBeenCalled();
    expect(snapshot.loadJobsAndAssets).not.toHaveBeenCalled();
    expect(snapshot.loadConversationState).not.toHaveBeenCalled();
  });
});

describe("handleGetSnapshot 成功快照", () => {
  it("handler 返回的 Project/Canvas ID 可直接进入恢复状态机", async () => {
    const huge = "9007199254740993";
    const res = await handleGetSnapshot("9", huge, {
      projects: makeProjectRepo({ ...sampleProject, id: huge }),
      canvas: {
        getByProject: vi.fn().mockResolvedValue({
          ...sampleCanvas,
          id: huge,
          project_id: huge,
        }),
      },
      snapshot: {
        loadJobsAndAssets: vi
          .fn()
          .mockResolvedValue({ generation_jobs: [], assets: [] }),
        loadConversationState: vi.fn().mockResolvedValue({
          conversation_messages: [],
          plan_messages: [],
          scene_cards: [],
          plan_applications: [],
          scene_card_generation_records: [],
          agent_runs: [],
          high_watermark_cursor: "0",
        }),
      },
    });

    expect(() =>
      applySnapshot(
        initialProjectRecoveryState(huge),
        res.data as unknown as ProjectSnapshot,
      ),
    ).not.toThrow();
    expect(res.data?.project.id).toBe(huge);
    expect(res.data?.canvas).toMatchObject({
      id: huge,
      project_id: huge,
    });
  });

  it("归属通过 → 200 + 完整信封（project/canvas 透传，jobs 映射，assets 含受控地址，cursor=0，messages/runs 空）", async () => {
    const projects = makeProjectRepo();
    const canvas = makeCanvasRepo();
    const job = {
      job_id: "100",
      type: "image",
      source: "dock",
      status: "succeeded",
      progress: 100,
      input: { prompt: "cat" },
      output_asset_ids: ["200"],
      stored_error: null,
    };
    const asset = {
      id: "200",
      type: "image",
      url: "https://cdn.example/x.png",
      project_id: "7",
    };
    const snapshot = {
      loadJobsAndAssets: vi
        .fn()
        .mockResolvedValue({ generation_jobs: [job], assets: [asset] }),
      loadConversationState: vi.fn().mockResolvedValue({
        conversation_messages: [],
        plan_messages: [],
        scene_cards: [],
        plan_applications: [],
        scene_card_generation_records: [],
        agent_runs: [],
        high_watermark_cursor: "0",
      }),
    };

    const res = await handleGetSnapshot("9", "7", {
      projects,
      canvas,
      snapshot,
    });

    expect(canvas.getByProject).toHaveBeenCalledWith("7");
    expect(snapshot.loadJobsAndAssets).toHaveBeenCalledWith("7", "9");
    expect(snapshot.loadConversationState).toHaveBeenCalledWith("7", "9");
    expect(res).toEqual({
      code: 200,
      msg: null,
      data: {
        project: { ...sampleProject, id: 7 },
        canvas: { ...sampleCanvas, id: 3, project_id: 7 },
        conversation_messages: [],
        plan_messages: [],
        scene_cards: [],
        plan_applications: [],
        scene_card_generation_records: [],
        agent_runs: [],
        generation_jobs: [
          {
            job_id: "100",
            type: "image",
            source: "dock",
            status: "succeeded",
            progress: 100,
            input: { prompt: "cat" },
            output_asset_ids: ["200"],
            error: null,
          },
        ],
        assets: {
          "200": {
            asset_id: "200",
            type: "image",
            access_url: "https://cdn.example/x.png",
          },
        },
        high_watermark_cursor: 0,
      },
    });
  });

  it("failed job → error 投影为公开信封（code/message 非空）", async () => {
    const projects = makeProjectRepo();
    const canvas = makeCanvasRepo();
    const job = {
      job_id: "101",
      type: "video",
      source: "dock",
      status: "failed",
      progress: 0,
      input: null,
      output_asset_ids: [],
      stored_error: { code: "timed_out" },
    };
    const snapshot = {
      loadJobsAndAssets: vi
        .fn()
        .mockResolvedValue({ generation_jobs: [job], assets: [] }),
      loadConversationState: vi.fn().mockResolvedValue({
        conversation_messages: [],
        plan_messages: [],
        scene_cards: [],
        plan_applications: [],
        scene_card_generation_records: [],
        agent_runs: [],
        high_watermark_cursor: "0",
      }),
    };

    const res = await handleGetSnapshot("9", "7", {
      projects,
      canvas,
      snapshot,
    });

    const wireJob = res.data?.generation_jobs[0];
    expect(wireJob?.error).not.toBeNull();
    expect(wireJob?.error?.code).toBe("timed_out");
    // 不泄漏 DB 原始 stored_error 到 wire
    expect(wireJob).not.toHaveProperty("stored_error");
  });

  it("超出安全整数的消息、Run、InputRequest 与 cursor ID 保持字符串", async () => {
    const huge = "9007199254740993";
    const res = await handleGetSnapshot("9", "7", {
      projects: makeProjectRepo(),
      canvas: makeCanvasRepo(),
      snapshot: {
        loadJobsAndAssets: vi
          .fn()
          .mockResolvedValue({ generation_jobs: [], assets: [] }),
        loadConversationState: vi.fn().mockResolvedValue({
          conversation_messages: [
            {
              message_id: huge,
              conversation_id: huge,
              agent_run_id: huge,
              role: "assistant",
              content: "蓝鲸",
              sequence_no: 1,
              created_at: "2026-07-29T00:00:00.000Z",
              mentions: [
                {
                  mention_id: huge,
                  index: 0,
                  type: "asset",
                  display_name: "蓝鲸",
                  availability: "available",
                  reason: null,
                  snapshot: { asset_type: "image" },
                },
              ],
            },
          ],
          agent_runs: [
            {
              agent_run_id: huge,
              conversation_id: huge,
              status: "awaiting_input",
              stage: null,
              input_sequence_no: 1,
              active_input_request: {
                input_request_id: huge,
                request_type: "creation_clarification",
                question: "什么风格？",
                status: "pending",
                expires_at: "2026-07-30T00:00:00.000Z",
              },
            },
          ],
          plan_messages: [],
          scene_cards: [],
          plan_applications: [],
          scene_card_generation_records: [],
          high_watermark_cursor: huge,
        }),
      },
    });

    expect(res.data?.high_watermark_cursor).toBe(huge);
    expect(res.data?.conversation_messages[0]).toMatchObject({
      message_id: huge,
      conversation_id: huge,
      agent_run_id: huge,
      mentions: [expect.objectContaining({ mention_id: huge })],
    });
    expect(res.data?.agent_runs[0]).toMatchObject({
      agent_run_id: huge,
      conversation_id: huge,
      active_input_request: { input_request_id: huge },
    });
  });
});

describe("assetAccessUrl", () => {
  it("项目图片 → 直接返回持久化 URL", () => {
    expect(
      assetAccessUrl("7", {
        id: "200",
        type: "image",
        url: "https://cdn/x.png",
        project_id: "7",
      }),
    ).toBe("https://cdn/x.png");
  });

  it("项目视频 → 直接返回持久化 URL", () => {
    expect(
      assetAccessUrl("7", {
        id: "9",
        type: "video",
        url: "https://cdn/x.mp4",
        project_id: "7",
      }),
    ).toBe("https://cdn/x.mp4");
  });

  it("project_id 为 null（全局 asset）→ 原始 url", () => {
    expect(
      assetAccessUrl("7", {
        id: "1",
        type: "image",
        url: "https://cdn/global.png",
        project_id: null,
      }),
    ).toBe("https://cdn/global.png");
  });

  it("历史生成 asset 没有 storage_key → 回退原始供应商 url", () => {
    const legacyAsset = {
      id: "203",
      type: "image",
      url: "https://provider.example/generated.png",
      project_id: "7",
      storage_key: null,
    };

    expect(assetAccessUrl("7", legacyAsset)).toBe(
      "https://provider.example/generated.png",
    );
  });
});
