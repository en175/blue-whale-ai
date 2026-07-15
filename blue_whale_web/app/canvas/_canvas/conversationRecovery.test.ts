import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@/lib/project-recovery";
import {
  projectSnapshotToCanvasNodes,
  projectSnapshotToChatMessages,
} from "./conversationRecovery";

describe("Agent 对话恢复投影", () => {
  it("从 Snapshot 重建消息与 agent_run 生成中卡片", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [
        {
          message_id: 1,
          agent_run_id: 5,
          role: "user",
          content: "生成一张蓝鲸海报",
          sequence_no: 1,
        },
        {
          message_id: 2,
          agent_run_id: 5,
          role: "assistant",
          content: "已接纳，正在生成图片。",
          sequence_no: 2,
        },
      ],
      agent_runs: [
        { agent_run_id: 5, status: "awaiting_job", stage: "generating" },
      ],
      generation_jobs: [
        {
          job_id: 9,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "蓝鲸海报" },
          status: "queued",
          progress: 0,
        },
      ],
      assets: {},
      high_watermark_cursor: 6,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toEqual([
      { id: "message-1", type: "user", text: "生成一张蓝鲸海报" },
      { id: "message-2", type: "agent", text: "已接纳，正在生成图片。" },
      {
        id: "generation-job-9-slot-0",
        type: "card",
        text: "蓝鲸海报",
        meta: "图片生成",
        status: "generating",
        generationJobId: 9,
        slotIndex: 0,
      },
    ]);
  });

  it("把成功输出的同一 asset_id 投影为 Card 与唯一 Canvas NodeItem", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [{ agent_run_id: 5, status: "awaiting_job" }],
      generation_jobs: [
        {
          job_id: 9,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "蓝鲸海报", aspect_ratio: "1:1" },
          status: "succeeded",
          progress: 100,
          outputs: [{ slot_index: 0, asset_id: 12 }],
          output_asset_ids: [12],
        },
      ],
      assets: {
        "12": {
          asset_id: 12,
          type: "image",
          access_url: "/api/projects/1/assets/12/content",
        },
      },
      high_watermark_cursor: 9,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toContainEqual(
      expect.objectContaining({
        id: "generation-job-9-slot-0",
        type: "card",
        assetId: "12",
        imageUrl: "/api/projects/1/assets/12/content",
      }),
    );
    const first = projectSnapshotToCanvasNodes(snapshot, []);
    const replayed = projectSnapshotToCanvasNodes(snapshot, first);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      id: "generation-job-9-slot-0",
      assetId: "12",
      imageUrl: "/api/projects/1/assets/12/content",
    });
  });

  it("把 BottomDock 成功输出投影为唯一 NodeItem 且不创建 Agent Card", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [],
      generation_jobs: [
        {
          job_id: 10,
          source: "bottom_dock",
          type: "image",
          input: { prompt: "码头蓝鲸", aspect_ratio: "16:9" },
          status: "succeeded",
          progress: 100,
          outputs: [{ slot_index: 0, asset_id: 13 }],
          output_asset_ids: [13],
        },
      ],
      assets: {
        "13": {
          asset_id: 13,
          type: "image",
          access_url: "/api/projects/1/assets/13/content",
        },
      },
      high_watermark_cursor: 12,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toEqual([]);
    const first = projectSnapshotToCanvasNodes(snapshot, []);
    const replayed = projectSnapshotToCanvasNodes(snapshot, first);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      id: "generation-job-10-slot-0",
      content: "码头蓝鲸",
      assetId: "13",
      imageUrl: "/api/projects/1/assets/13/content",
    });
  });

  it("把 BottomDock 视频输出恢复为稳定 video 节点且不持久化签名 URL", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [],
      generation_jobs: [
        {
          job_id: 11,
          source: "bottom_dock",
          type: "video",
          input: { prompt: "蓝鲸跃出海面", aspect_ratio: "16:9" },
          status: "succeeded",
          progress: null,
          outputs: [{ slot_index: 0, asset_id: 14 }],
          output_asset_ids: [14],
        },
      ],
      assets: {
        "14": {
          asset_id: 14,
          type: "video",
          access_url: "/api/projects/1/assets/14",
        },
      },
      high_watermark_cursor: 16,
    };

    const first = projectSnapshotToCanvasNodes(snapshot, []);
    const replayed = projectSnapshotToCanvasNodes(snapshot, first);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({
      id: "generation-job-11-slot-0",
      type: "video",
      content: "蓝鲸跃出海面",
      assetId: "14",
      assetAccessUrl: "/api/projects/1/assets/14",
    });
    expect(JSON.stringify(replayed[0])).not.toContain("signature=");
    expect(replayed[0]).not.toHaveProperty("imageUrl");
  });

  it("部分成功时每个输出槽生成一张 Card，只有成功槽生成 Node", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [{ agent_run_id: 5, status: "succeeded" }],
      generation_jobs: [
        {
          job_id: 20,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "两张蓝鲸", aspect_ratio: "1:1" },
          status: "partially_succeeded",
          expected_output_count: 2,
          outputs: [
            { slot_index: 0, status: "succeeded", asset_id: 30 },
            {
              slot_index: 1,
              status: "failed",
              asset_id: null,
              error: { code: "provider_failed", message: "图像生成失败" },
            },
          ],
          output_asset_ids: [30],
        },
      ],
      assets: {
        "30": {
          asset_id: 30,
          type: "image",
          access_url: "/api/projects/1/assets/30/content",
        },
      },
      high_watermark_cursor: 20,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toEqual([
      expect.objectContaining({
        id: "generation-job-20-slot-0",
        generationJobId: 20,
        slotIndex: 0,
        status: "normal",
        assetId: "30",
      }),
      expect.objectContaining({
        id: "generation-job-20-slot-1",
        generationJobId: 20,
        slotIndex: 1,
        status: "failed",
      }),
    ]);
    expect(projectSnapshotToCanvasNodes(snapshot, [])).toEqual([
      expect.objectContaining({
        id: "generation-job-20-slot-0",
        assetId: "30",
      }),
    ]);
  });
});
