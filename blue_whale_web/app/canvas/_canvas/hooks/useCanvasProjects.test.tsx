// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { acceptConversationMessage } from "@/lib/conversation";
import { runProjectRecovery } from "@/lib/project-recovery";
import type {
  ProjectRecoveryState,
  ProjectSnapshot,
} from "@/lib/project-recovery";
import { useCanvasProjects } from "./useCanvasProjects";

vi.mock("@/components/auth/authStorage", () => ({
  loadAccessToken: vi.fn(() => "test-token"),
}));
vi.mock("@/lib/canvas", () => ({
  listProjects: vi.fn(async () => [{ id: 1, name: "demo", thumb: null }]),
  createProject: vi.fn(),
  saveCanvas: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
}));
vi.mock("@/lib/conversation", () => ({
  acceptConversationMessage: vi.fn(async () => ({
    message_id: 1,
    agent_run_id: 2,
    cursor: 3,
  })),
}));
vi.mock("@/lib/command-identity", () => ({
  newCommandIdentity: vi.fn(() => "cmd-id"),
}));
vi.mock("@/lib/project-recovery", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/project-recovery")>();
  return {
    ...actual,
    runProjectRecovery: vi.fn(),
    projectRecoveryTransport: {},
  };
});

function snapshotWith(
  agentRuns: Array<Record<string, unknown>>,
): ProjectSnapshot {
  return {
    project: { id: 1, name: "demo", thumb: null, created_at: "2026-07-17" },
    canvas: { id: 2, project_id: 1, viewport: '{"zoom":1}', nodes: "[]" },
    conversation_messages: [],
    agent_runs: agentRuns,
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: 10,
  };
}

function recoveryState(snapshot: ProjectSnapshot): ProjectRecoveryState {
  return {
    projectId: 1,
    snapshot,
    lastCursor: snapshot.high_watermark_cursor,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
  };
}

const awaitingClarificationRun = {
  agent_run_id: 5,
  conversation_id: 3,
  status: "awaiting_input",
  active_input_request: {
    input_request_id: 42,
    request_type: "creation_clarification",
    question: "希望什么风格？",
    status: "pending",
    expires_at: "2099-01-01T00:00:00Z",
  },
};

async function renderRecoveredPanel(snapshot: ProjectSnapshot) {
  const rendered = renderHook(() => useCanvasProjects());
  await waitFor(() => expect(rendered.result.current.backendReady).toBe(true));
  await waitFor(() => expect(vi.mocked(runProjectRecovery)).toHaveBeenCalled());
  const onState = vi.mocked(runProjectRecovery).mock.calls[0][2];
  act(() => onState(recoveryState(snapshot)));
  return rendered;
}

describe("useCanvasProjects 创作澄清回答绑定", () => {
  it("当前流程等待澄清时，下一条非空 Composer 消息携带对应 reply_to_input_request_id", async () => {
    const { result } = await renderRecoveredPanel(
      snapshotWith([awaitingClarificationRun]),
    );

    await act(async () => {
      await result.current.submitConversationMessageAction("水墨风格带留白");
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      1,
      "水墨风格带留白",
      "cmd-id",
      "cmd-id",
      42,
    );
  });

  it("没有活动澄清请求时，普通消息提交保持现状（不携带绑定）", async () => {
    const { result } = await renderRecoveredPanel(snapshotWith([]));

    await act(async () => {
      await result.current.submitConversationMessageAction("生成一张蓝鲸海报");
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      1,
      "生成一张蓝鲸海报",
      "cmd-id",
      "cmd-id",
      undefined,
    );
  });
});
