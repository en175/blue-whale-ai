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
        id: "generation-job-9",
        type: "card",
        text: "蓝鲸海报",
        meta: "图片生成",
        status: "generating",
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
        id: "generation-job-9",
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
});
