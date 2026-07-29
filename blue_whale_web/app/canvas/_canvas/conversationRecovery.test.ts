import { describe, expect, it } from "vitest";
import {
  applyProductEvent,
  applySnapshot,
  initialProjectRecoveryState,
  type ProductEventEnvelope,
  type ProjectSnapshot,
} from "@/lib/project-recovery";
import {
  projectSnapshotToCanvasNodes,
  projectSnapshotToChatMessages,
  selectCurrentRunCreativeSkillId,
  selectCurrentRunId,
} from "./conversationRecovery";

function envelope(
  overrides: Partial<ProductEventEnvelope>,
): ProductEventEnvelope {
  return {
    schema_version: 1,
    event_id: "evt",
    event_type: "project.renamed",
    cursor: 6,
    project_id: 1,
    aggregate_type: "project",
    aggregate_id: "1",
    aggregate_version: 1,
    correlation_id: null,
    causation_id: null,
    occurred_at: "2026-07-25T00:00:00",
    payload: {},
    ...overrides,
  };
}

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

  it("失败 Card 投影产品规范化错误文案且不泄漏内部信息", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [{ agent_run_id: 5, status: "completed" }],
      generation_jobs: [
        {
          job_id: 30,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "失败的蓝鲸", aspect_ratio: "1:1" },
          status: "failed",
          outputs: [
            {
              slot_index: 0,
              status: "failed",
              asset_id: null,
              error: { code: "provider_failed", message: "图像生成失败" },
            },
          ],
          output_asset_ids: [],
        },
      ],
      assets: {},
      high_watermark_cursor: 30,
    };

    const cards = projectSnapshotToChatMessages(snapshot);
    expect(cards).toEqual([
      expect.objectContaining({
        id: "generation-job-30-slot-0",
        status: "failed",
        errorMessage: "图像生成失败",
      }),
    ]);
    // 不泄漏后端内部原始 message（"Fake Provider 显式失败" 等）
    expect(JSON.stringify(cards)).not.toContain("Fake Provider");
  });

  it("Job 级失败回退投影 job.error.message（无 output.error 时）", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [{ agent_run_id: 5, status: "completed" }],
      generation_jobs: [
        {
          job_id: 31,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "失败的蓝鲸" },
          status: "failed",
          error: { code: "provider_failed", message: "图像生成失败" },
          outputs: [{ slot_index: 0, status: "failed", asset_id: null }],
          output_asset_ids: [],
        },
      ],
      assets: {},
      high_watermark_cursor: 31,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toEqual([
      expect.objectContaining({
        id: "generation-job-31-slot-0",
        status: "failed",
        errorMessage: "图像生成失败",
      }),
    ]);
  });

  it("取消槽恢复为独立取消态且不生成 Node", () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [{ agent_run_id: 5, status: "completed" }],
      generation_jobs: [
        {
          job_id: 21,
          agent_run_id: 5,
          source: "agent_run",
          type: "image",
          input: { prompt: "取消的蓝鲸" },
          status: "cancelled",
          outputs: [{ slot_index: 0, status: "cancelled", asset_id: null }],
          output_asset_ids: [],
        },
      ],
      assets: {},
      high_watermark_cursor: 21,
    };

    expect(projectSnapshotToChatMessages(snapshot)).toEqual([
      expect.objectContaining({
        id: "generation-job-21-slot-0",
        status: "cancelled",
      }),
    ]);
    expect(projectSnapshotToCanvasNodes(snapshot, [])).toEqual([]);
  });
});

describe("当前 Run 已激活 Creative Skill 选择器", () => {
  it("取 agent_run_id 最大 run 的首项 creative_skill_id", () => {
    const runs = [
      {
        agent_run_id: 5,
        activated_creative_skill_versions: [
          { creative_skill_id: "cs_a", source: "forced_use" },
        ],
      },
      {
        agent_run_id: 8,
        activated_creative_skill_versions: [
          { creative_skill_id: "cs_b", source: "forced_use" },
        ],
      },
    ];
    expect(selectCurrentRunCreativeSkillId(runs)).toBe("cs_b");
  });

  it("当前最大 run 无激活数组或空数组时返回 null", () => {
    expect(
      selectCurrentRunCreativeSkillId([
        { agent_run_id: 5, activated_creative_skill_versions: [] },
        { agent_run_id: 8 },
      ]),
    ).toBeNull();
  });

  it("激活字段非数组形态时返回 null，不抛错", () => {
    expect(
      selectCurrentRunCreativeSkillId([
        { agent_run_id: 8, activated_creative_skill_versions: "[]" },
      ]),
    ).toBeNull();
  });

  it("空 runs 返回 null", () => {
    expect(selectCurrentRunCreativeSkillId([])).toBeNull();
  });

  it("Snapshot 首载 + SSE 重连 replay 后选择器仍指向同一 creative_skill_id", () => {
    const initial: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [
        {
          agent_run_id: 5,
          activated_creative_skill_versions: [{ creative_skill_id: "cs_a" }],
        },
      ],
      generation_jobs: [],
      assets: {},
      high_watermark_cursor: 5,
    };
    let state = applySnapshot(initialProjectRecoveryState(1), initial);

    // 模拟刷新/断线重连后回放的非 run 事件：不得冲掉当前 Run 的技能标签。
    state = applyProductEvent(
      state,
      envelope({
        event_id: "evt_rename",
        cursor: 6,
        event_type: "project.renamed",
        aggregate_type: "project",
        aggregate_id: "1",
        aggregate_version: 2,
        payload: { name: "改名" },
      }),
    );
    state = applyProductEvent(
      state,
      envelope({
        event_id: "evt_canvas",
        cursor: 7,
        event_type: "canvas.updated",
        aggregate_type: "canvas",
        aggregate_id: "2",
        aggregate_version: 0,
        payload: { viewport: '{"zoom":2}', nodes: "[]" },
      }),
    );

    expect(
      selectCurrentRunCreativeSkillId(state.snapshot?.agent_runs ?? []),
    ).toBe("cs_a");
  });

  it("更高 Run 经 agent_run.created 接管后选择器返回新 id", () => {
    const initial: ProjectSnapshot = {
      project: { id: 1, name: "P", thumb: null, created_at: "now" },
      canvas: { id: null, project_id: 1, viewport: null, nodes: "[]" },
      conversation_messages: [],
      agent_runs: [
        {
          agent_run_id: 5,
          activated_creative_skill_versions: [{ creative_skill_id: "cs_a" }],
        },
      ],
      generation_jobs: [],
      assets: {},
      high_watermark_cursor: 5,
    };
    let state = applySnapshot(initialProjectRecoveryState(1), initial);

    state = applyProductEvent(
      state,
      envelope({
        event_id: "evt_run_created",
        cursor: 6,
        event_type: "agent_run.created",
        aggregate_type: "agent_run",
        aggregate_id: "9",
        aggregate_version: 0,
        payload: {
          agent_run_id: 9,
          status: "queued",
          activated_creative_skill_versions: [{ creative_skill_id: "cs_b" }],
        },
      }),
    );

    expect(
      selectCurrentRunCreativeSkillId(state.snapshot?.agent_runs ?? []),
    ).toBe("cs_b");
  });
});

describe("当前 Run id 选择器", () => {
  it("空数组返回 null", () => {
    expect(selectCurrentRunId([])).toBeNull();
  });

  it("多 run 取 agent_run_id 数值最大者", () => {
    expect(
      selectCurrentRunId([
        { agent_run_id: 5 },
        { agent_run_id: 8 },
        { agent_run_id: 3 },
      ]),
    ).toBe(8);
  });

  it("字符串 id 按数值参与比较", () => {
    expect(
      selectCurrentRunId([{ agent_run_id: "9" }, { agent_run_id: 4 }]),
    ).toBe(9);
  });

  it("相邻超大 run ID 精确选择数值最大者", () => {
    expect(
      selectCurrentRunId([
        { agent_run_id: "9007199254740992" },
        { agent_run_id: "9007199254740993" },
      ]),
    ).toBe("9007199254740993");
  });

  it("相邻超大 run ID 精确选择最新 Creative Skill", () => {
    expect(
      selectCurrentRunCreativeSkillId([
        {
          agent_run_id: "9007199254740992",
          activated_creative_skill_versions: [
            { creative_skill_id: "old" },
          ],
        },
        {
          agent_run_id: "9007199254740993",
          activated_creative_skill_versions: [
            { creative_skill_id: "latest" },
          ],
        },
      ]),
    ).toBe("latest");
  });

  it("无有效 id 返回 null", () => {
    expect(selectCurrentRunId([{ agent_run_id: "abc" }, {}])).toBeNull();
  });
});
