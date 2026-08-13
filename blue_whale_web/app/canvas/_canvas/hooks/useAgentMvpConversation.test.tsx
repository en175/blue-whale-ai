// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEventEnvelope,
  AgentSessionSummary,
  AgentSnapshot,
} from "@/lib/agent-service/client";

const mocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
  createAgentSession: vi.fn(),
  getAgentSnapshot: vi.fn(),
  acceptAgentMessage: vi.fn(),
  runAgentCommand: vi.fn(),
  streamAgentEvents: vi.fn(),
  onEvent: null as ((event: AgentEventEnvelope) => void) | null,
}));

vi.mock("@/lib/agent-service/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/agent-service/client")>();
  return {
    ...original,
    listAgentSessions: mocks.listAgentSessions,
    createAgentSession: mocks.createAgentSession,
    getAgentSnapshot: mocks.getAgentSnapshot,
    acceptAgentMessage: mocks.acceptAgentMessage,
    runAgentCommand: mocks.runAgentCommand,
    streamAgentEvents: mocks.streamAgentEvents,
  };
});

import { useAgentMvpConversation } from "./useAgentMvpConversation";

const stored = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    clear: () => stored.clear(),
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => stored.delete(key),
    setItem: (key: string, value: string) => stored.set(key, value),
  },
});

function session(id: string, updatedAt: string): AgentSessionSummary {
  return {
    session_id: id,
    title: `会话 ${id}`,
    title_source: "agent_generated",
    phase: "open",
    lifecycle: "active",
    active_run_id: null,
    pending_message_count: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    etag: 'W/"session-1"',
  };
}

function snapshot(current: AgentSessionSummary): AgentSnapshot {
  return {
    session: current,
    messages: [
      {
        message_id: `msg-${current.session_id}`,
        session_id: current.session_id,
        sequence: 1,
        role: "user",
        content: [{ type: "text", text: "历史输入" }],
        input_batch_id: "batch-1",
        source_run_id: null,
        created_at: current.created_at,
      },
    ],
    active_run: null,
    latest_terminal_run: null,
    event_cursor: "evt-snapshot",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useAgentMvpConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.onEvent = null;
    mocks.streamAgentEvents.mockImplementation(
      ({
        signal,
        onEvent,
      }: {
        signal: AbortSignal;
        onEvent: (event: AgentEventEnvelope) => void;
      }) => {
        mocks.onEvent = onEvent;
        return new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    );
  });

  it("restores the valid Project preference and formal history", async () => {
    const preferred = session("preferred", "2026-08-12T01:00:00.000Z");
    const recent = session("recent", "2026-08-12T02:00:00.000Z");
    window.localStorage.setItem(
      "blue-whale:agent:last-session:101",
      preferred.session_id,
    );
    mocks.listAgentSessions.mockResolvedValue([recent, preferred]);
    mocks.getAgentSnapshot.mockResolvedValue(snapshot(preferred));
    const { result, unmount } = renderHook(() =>
      useAgentMvpConversation("101"),
    );
    await waitFor(() =>
      expect(result.current.selectedSessionId).toBe("preferred"),
    );
    await waitFor(() =>
      expect(result.current.messages[0]?.text).toBe("历史输入"),
    );
    expect(mocks.getAgentSnapshot).toHaveBeenCalledWith("101", "preferred");
    unmount();
  });

  it("keeps an empty state and creates a Session only on first input", async () => {
    const created = session("created", "2026-08-12T02:00:00.000Z");
    mocks.listAgentSessions.mockResolvedValue([]);
    mocks.createAgentSession.mockResolvedValue(created);
    mocks.getAgentSnapshot.mockResolvedValue(snapshot(created));
    mocks.acceptAgentMessage.mockResolvedValue({
      message: {
        message_id: "msg-new",
        session_id: created.session_id,
        sequence: 1,
        role: "user",
        content: [{ type: "text", text: "第一条输入" }],
        input_batch_id: "batch-new",
        source_run_id: null,
        created_at: created.created_at,
      },
      scheduling: {
        state: "run_created",
        input_batch_id: "batch-new",
        run_id: "run-new",
      },
    });
    const { result, unmount } = renderHook(() =>
      useAgentMvpConversation("101"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.createAgentSession).not.toHaveBeenCalled();
    await act(async () => result.current.sendMessage("第一条输入"));
    expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
    expect(mocks.acceptAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "101",
        sessionId: "created",
        message: "第一条输入",
      }),
    );
    expect(result.current.selectedSessionId).toBe("created");
    unmount();
  });

  it("shows provisional deltas and replaces them with the formal completed Message", async () => {
    const current = session("stream", "2026-08-12T02:00:00.000Z");
    mocks.listAgentSessions.mockResolvedValue([current]);
    mocks.getAgentSnapshot.mockResolvedValue(snapshot(current));
    const { result, unmount } = renderHook(() =>
      useAgentMvpConversation("101"),
    );
    await waitFor(() => expect(mocks.onEvent).not.toBeNull());
    act(() =>
      mocks.onEvent?.({
        schema_version: 1,
        event_id: "evt-delta",
        cursor: "evt-delta",
        type: "assistant.delta",
        occurred_at: current.updated_at,
        session_id: current.session_id,
        run_id: "run-1",
        payload: { text: "临时" },
      }),
    );
    expect(result.current.provisionalContent).toBe("临时");
    act(() =>
      mocks.onEvent?.({
        schema_version: 1,
        event_id: "evt-completed",
        cursor: "evt-completed",
        type: "run.completed",
        occurred_at: current.updated_at,
        session_id: current.session_id,
        run_id: "run-1",
        payload: {
          run: {
            run_id: "run-1",
            session_id: current.session_id,
            input_batch_id: "batch-1",
            attempt_no: 1,
            retry_of_run_id: null,
            status: "completed",
            failure: null,
            created_at: current.created_at,
            started_at: current.created_at,
            finished_at: current.updated_at,
            trace_id: "trace-1",
          },
          assistant_message: {
            message_id: "msg-assistant",
            session_id: current.session_id,
            sequence: 2,
            role: "assistant",
            content: [{ type: "text", text: "正式回复" }],
            input_batch_id: "batch-1",
            source_run_id: "run-1",
            created_at: current.updated_at,
          },
        },
      }),
    );
    expect(result.current.provisionalContent).toBeNull();
    expect(result.current.messages.at(-1)?.text).toBe("正式回复");
    unmount();
  });

  it("keeps payment_required as the active resumable Run instead of a terminal Run", async () => {
    const current = session("payment", "2026-08-12T02:00:00.000Z");
    mocks.listAgentSessions.mockResolvedValue([current]);
    mocks.getAgentSnapshot.mockResolvedValue(snapshot(current));
    const { result, unmount } = renderHook(() =>
      useAgentMvpConversation("101"),
    );
    await waitFor(() => expect(mocks.onEvent).not.toBeNull());
    act(() =>
      mocks.onEvent?.({
        schema_version: 1,
        event_id: "evt-payment",
        cursor: "evt-payment",
        type: "run.payment_required",
        occurred_at: current.updated_at,
        session_id: current.session_id,
        run_id: "run-payment",
        payload: {
          run: {
            run_id: "run-payment",
            session_id: current.session_id,
            input_batch_id: "batch-payment",
            attempt_no: 1,
            retry_of_run_id: null,
            status: "payment_required",
            failure: {
              code: "capability_required",
              message: "需要重新授权后继续。",
            },
            created_at: current.created_at,
            started_at: null,
            finished_at: null,
            trace_id: "trace-payment",
          },
        },
      }),
    );
    expect(result.current.controls.canResume).toBe(true);
    expect(result.current.controls.canRetry).toBe(false);
    expect(result.current.blockingRun?.status).toBe("payment_required");
    unmount();
  });

  it("does not restore a late Session response from the previously selected Project", async () => {
    const oldProject = deferred<AgentSessionSummary[]>();
    const current = session("project-202", "2026-08-12T03:00:00.000Z");
    mocks.listAgentSessions.mockImplementation((projectId: string) =>
      projectId === "101" ? oldProject.promise : Promise.resolve([current]),
    );
    mocks.getAgentSnapshot.mockResolvedValue(snapshot(current));
    const { result, rerender, unmount } = renderHook(
      ({ projectId }) => useAgentMvpConversation(projectId),
      { initialProps: { projectId: "101" } },
    );
    rerender({ projectId: "202" });
    await waitFor(() =>
      expect(result.current.selectedSessionId).toBe("project-202"),
    );
    oldProject.resolve([
      session("stale-project-101", "2026-08-12T04:00:00.000Z"),
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.selectedSessionId).toBe("project-202");
    expect(result.current.sessions.map((item) => item.session_id)).toEqual([
      "project-202",
    ]);
    unmount();
  });
});
