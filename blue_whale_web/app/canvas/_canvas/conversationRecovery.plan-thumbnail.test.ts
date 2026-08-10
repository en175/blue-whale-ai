import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  applyProductEvent,
  applySnapshot,
  initialProjectRecoveryState,
  type ProductEventEnvelope,
  type ProjectSnapshot,
} from "@/lib/project-recovery";
import type { ChatMessage } from "./types";
import { projectSnapshotToChatMessages } from "./conversationRecovery";
import { PlanCard } from "./components/ChatBubbles";

vi.mock("./components/AuthenticatedImage", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    AuthenticatedImage: ({
      accessUrl,
      alt,
    }: {
      accessUrl: string;
      alt: string;
    }) => createMockElement("img", { src: accessUrl, alt }),
  };
});

/**
 * IK7EP1：图片计划卡首图缩略图 —— 事件→快照→投影全链路。
 * 计划手动应用后，其首图 GenerationJob 的成功 generation_job.output_attached 事件
 * （配合 asset.created 并入的鉴权 access_url）应驱动 plan-card 就地携带 thumbnailUrl；
 * 失败 / 无成功输出 / 未应用时不携带。
 */

const ACCESS_URL = "/api/projects/1/assets/901/content";

function planSnapshot(
  planOverrides: Record<string, unknown> = {},
): ProjectSnapshot {
  return {
    project: {
      id: 1,
      name: "P",
      thumb: null,
      created_at: "2026-08-07T00:00:00",
    },
    canvas: { id: 2, project_id: 1, viewport: null, nodes: "[]" },
    conversation_messages: [
      {
        message_id: 7,
        agent_run_id: 5,
        role: "assistant",
        content_type: "plan_message",
        content: "# 冻结正文",
        sequence_no: 1,
      },
    ],
    agent_runs: [{ agent_run_id: 5, status: "completed" }],
    generation_jobs: [
      {
        job_id: 55,
        type: "image",
        source: "plan_apply",
        status: "running",
        output_slots: [],
      },
    ],
    plan_messages: [
      {
        message_id: 7,
        application_kind: "image_generate",
        content_markdown: "# 冻结正文\n一只蓝鲸跃出海面",
        sequence_label: "Scene 1 · Shot 2",
        applied_at: "2026-08-07T06:00:00.000Z",
        first_generation_job_id: 55,
        application_availability: "available",
        ...planOverrides,
      },
    ],
    plan_applications: [],
    assets: {},
    high_watermark_cursor: 10,
  };
}

function event(overrides: Partial<ProductEventEnvelope>): ProductEventEnvelope {
  return {
    schema_version: 1,
    event_id: "evt_1",
    event_type: "asset.created",
    cursor: 11,
    project_id: 1,
    aggregate_type: "asset",
    aggregate_id: "901",
    aggregate_version: 0,
    correlation_id: null,
    causation_id: null,
    occurred_at: "2026-08-07T06:00:01.000Z",
    payload: {},
    ...overrides,
  };
}

function planCardOf(
  snapshot: ProjectSnapshot | null | undefined,
): Extract<ChatMessage, { type: "plan-card" }> {
  if (!snapshot) throw new Error("snapshot 缺失");
  const card = projectSnapshotToChatMessages(snapshot).find(
    (message) => message.type === "plan-card",
  );
  if (!card || card.type !== "plan-card") throw new Error("plan-card 未投影");
  return card;
}

describe("IK7EP1 计划卡首图缩略图（事件→投影）", () => {
  it("首图 output_attached 成功 + asset.created → plan-card 携带首图缩略图", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), planSnapshot());
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_asset_11",
        payload: { asset_id: 901, type: "image", access_url: ACCESS_URL },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_12",
        event_type: "generation_job.output_attached",
        cursor: 12,
        aggregate_type: "generation_job_output",
        aggregate_id: "55:0",
        payload: {
          job_id: 55,
          slot_index: 0,
          status: "succeeded",
          asset_id: 901,
        },
      }),
    );

    const card = planCardOf(state.snapshot);
    expect(card).toEqual(
      expect.objectContaining({
        planMessageId: 7,
        firstGenerationJobId: 55,
        thumbnailUrl: ACCESS_URL,
      }),
    );
    const html = renderToStaticMarkup(createElement(PlanCard, { msg: card }));
    expect(html).toContain(`src="${ACCESS_URL}"`);
    expect(html).toContain('alt="Scene 1 · Shot 2"');
  });

  it("首图 job 真实失败序列 → 无缩略图，计划卡其余字段不受影响", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), planSnapshot());
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_job_11",
        event_type: "generation_job.status_changed",
        aggregate_type: "generation_job",
        aggregate_id: "55",
        payload: {
          job_id: 55,
          type: "image",
          source: "plan_apply",
          status: "failed",
          progress: 100,
          error: { code: "provider_failed", message: "图像生成失败" },
        },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_12",
        event_type: "generation_job.output_updated",
        cursor: 12,
        aggregate_type: "generation_job_output",
        aggregate_id: "55:0",
        payload: {
          job_id: 55,
          slot_index: 0,
          status: "failed",
          asset_id: null,
          error: { code: "provider_failed", message: "图像生成失败" },
        },
      }),
    );

    const card = planCardOf(state.snapshot);
    expect(card).not.toHaveProperty("thumbnailUrl");
    expect(card.applicationAvailability).toBe("available");
    expect(card.appliedAt).toBe("2026-08-07T06:00:00.000Z");
  });

  it("输出成功但 Asset 投影未到达 → 保守不显示缩略图", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), planSnapshot());
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_11",
        event_type: "generation_job.output_attached",
        aggregate_type: "generation_job_output",
        aggregate_id: "55:0",
        payload: {
          job_id: 55,
          slot_index: 0,
          status: "succeeded",
          asset_id: 901,
        },
      }),
    );

    expect(planCardOf(state.snapshot)).not.toHaveProperty("thumbnailUrl");
  });

  it("计划未应用（first_generation_job_id 为 null）→ 无缩略图", () => {
    const state = applySnapshot(
      initialProjectRecoveryState(1),
      planSnapshot({ applied_at: null, first_generation_job_id: null }),
    );

    expect(planCardOf(state.snapshot)).not.toHaveProperty("thumbnailUrl");
  });
});
