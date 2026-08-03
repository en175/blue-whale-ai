// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectConversation } from "./useProjectConversation";
import type {
  ProjectRecoveryState,
  ProjectSnapshot,
} from "@/lib/project-recovery";

type RecoveryArgs = [
  projectId: string,
  transport: unknown,
  onState: (state: ProjectRecoveryState) => void,
  signal: AbortSignal,
];

const recoveryMock = vi.fn<(...args: RecoveryArgs) => Promise<void>>();

vi.mock("@/lib/project-recovery", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/project-recovery")>();
  return {
    ...actual,
    projectRecoveryTransport: {
      loadSnapshot: vi.fn(),
      consumeEvents: vi.fn(),
    },
    runProjectRecovery: (...args: RecoveryArgs) => recoveryMock(...args),
  };
});

const acceptMock = vi.fn().mockResolvedValue({
  message_id: "1",
  agent_run_id: "1",
  cursor: "1",
});
vi.mock("@/lib/conversation", () => ({
  acceptConversationMessage: (...args: never[]) => acceptMock(...args),
}));

let commandCounter = 0;
vi.mock("@/lib/command-identity", () => ({
  newCommandIdentity: () => `cmd-${++commandCounter}`,
}));

function makeSnapshot(
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot {
  return {
    project: {
      id: "101",
      name: "p",
      thumb: null,
      created_at: "2026-08-03T00:00:00Z",
    },
    canvas: { id: "1", project_id: "101", viewport: null, nodes: null },
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: "0",
    ...overrides,
  };
}

describe("useProjectConversation（画布持久化对话接线 IK67GD T02）", () => {
  afterEach(() => {
    vi.clearAllMocks();
    commandCounter = 0;
  });

  it("backendReady 且 projectId 变化时对该 Project 建立恢复循环", async () => {
    renderHook(() => useProjectConversation("101", true));
    await waitFor(() => expect(recoveryMock).toHaveBeenCalledTimes(1));
    expect(recoveryMock.mock.calls[0][0]).toBe("101");
  });

  it("后端不可用时不建立恢复循环", () => {
    renderHook(() => useProjectConversation("101", false));
    expect(recoveryMock).not.toHaveBeenCalled();
  });

  it("Snapshot 已接纳消息按服务端顺序投影为面板消息", async () => {
    const snapshot = makeSnapshot({
      conversation_messages: [
        { message_id: 2, role: "assistant", content: "回复", sequence_no: 2 },
        { message_id: 1, role: "user", content: "你好", sequence_no: 1 },
      ],
    });
    recoveryMock.mockImplementation(async (_pid, _transport, onState) => {
      onState({
        projectId: "101",
        snapshot,
        lastCursor: "0",
        seenEventIds: new Set(),
        aggregateVersions: new Map(),
        deleted: false,
      });
    });

    const { result } = renderHook(() => useProjectConversation("101", true));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({
      type: "user",
      text: "你好",
    });
    expect(result.current.messages[1]).toMatchObject({
      type: "agent",
      text: "回复",
    });
  });

  it("sendMessage 走公开接纳 API 并携带 CommandId 幂等键", async () => {
    const { result } = renderHook(() => useProjectConversation("101", true));
    await act(async () => {
      await result.current.sendMessage("第一条消息");
    });
    expect(acceptMock).toHaveBeenCalledTimes(1);
    const [projectId, content, clientMessageId, idempotencyKey] =
      acceptMock.mock.calls[0];
    expect(projectId).toBe("101");
    expect(content).toBe("第一条消息");
    expect(clientMessageId).toBe("cmd-1");
    expect(idempotencyKey).toBe("cmd-2");
  });

  it("存在可回答澄清时绑定 reply_to 且屏蔽 forced skill", async () => {
    const snapshot = makeSnapshot({
      agent_runs: [
        {
          agent_run_id: 7,
          active_input_request: {
            input_request_id: "9",
            request_type: "creation_clarification",
            status: "pending",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ],
    });
    recoveryMock.mockImplementation(async (_pid, _transport, onState) => {
      onState({
        projectId: "101",
        snapshot,
        lastCursor: "0",
        seenEventIds: new Set(),
        aggregateVersions: new Map(),
        deleted: false,
      });
    });

    const { result } = renderHook(() => useProjectConversation("101", true));
    await waitFor(() => expect(result.current.answerableActive).toBe(true));
    await act(async () => {
      await result.current.sendMessage("回答", undefined, "cs_x");
    });
    expect(acceptMock).toHaveBeenCalledWith(
      "101",
      "回答",
      expect.any(String),
      expect.any(String),
      "9",
      undefined,
      undefined,
      false,
    );
  });

  it("失败后同内容重试复用同一 CommandId，换内容或成功后换新键", async () => {
    acceptMock.mockRejectedValueOnce(new Error("结果未知"));
    const { result } = renderHook(() => useProjectConversation("101", true));

    await act(async () => {
      await expect(result.current.sendMessage("同一条内容")).rejects.toThrow();
    });
    const firstCall = acceptMock.mock.calls[0];

    await act(async () => {
      await result.current.sendMessage("同一条内容");
    });
    const retryCall = acceptMock.mock.calls[1];
    expect(retryCall[2]).toBe(firstCall[2]);
    expect(retryCall[3]).toBe(firstCall[3]);

    await act(async () => {
      await result.current.sendMessage("换了内容");
    });
    const changedCall = acceptMock.mock.calls[2];
    expect(changedCall[2]).not.toBe(firstCall[2]);
    expect(changedCall[3]).not.toBe(firstCall[3]);

    await act(async () => {
      await result.current.sendMessage("换了内容");
    });
    const afterSuccess = acceptMock.mock.calls[3];
    expect(afterSuccess[2]).not.toBe(changedCall[2]);
    expect(afterSuccess[3]).not.toBe(changedCall[3]);
  });

  it("卸载时中止恢复循环", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const { unmount } = renderHook(() => useProjectConversation("101", true));
    await waitFor(() => expect(recoveryMock).toHaveBeenCalled());
    unmount();
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });
});
