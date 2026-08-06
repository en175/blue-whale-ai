// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listProjects, deleteProject } from "@/lib/canvas";
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
    provisionalDeliveries: new Map(),
    incompatible: false,
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
  beforeEach(() => vi.clearAllMocks());

  it("当前流程等待澄清时，下一条非空 Composer 消息携带对应 reply_to_input_request_id", async () => {
    const { result } = await renderRecoveredPanel(
      snapshotWith([awaitingClarificationRun]),
    );

    await act(async () => {
      await result.current.submitConversationMessageAction("水墨风格带留白");
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      "1",
      "水墨风格带留白",
      "cmd-id",
      "cmd-id",
      42,
      undefined,
      undefined,
    );
  });

  it("没有活动澄清请求时，普通消息提交保持现状（不携带绑定）", async () => {
    const { result } = await renderRecoveredPanel(snapshotWith([]));

    await act(async () => {
      await result.current.submitConversationMessageAction("生成一张蓝鲸海报");
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      "1",
      "生成一张蓝鲸海报",
      "cmd-id",
      "cmd-id",
      undefined,
      undefined,
      undefined,
    );
  });

  it("携带有序 mentions 时透传给 acceptConversationMessage（DOM 序去重由上游负责）", async () => {
    const { result } = await renderRecoveredPanel(snapshotWith([]));
    const mentions = [
      { type: "asset" as const, asset_id: "9", display_name: "A" },
      { type: "asset" as const, asset_id: "3", display_name: "B" },
    ];

    await act(async () => {
      await result.current.submitConversationMessageAction(
        "参考这张",
        mentions,
      );
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      "1",
      "参考这张",
      "cmd-id",
      "cmd-id",
      undefined,
      mentions,
      undefined,
    );
  });

  it("无活动澄清时 forced Creative Skill 随消息透传（forced_creative_skill_id）", async () => {
    const { result } = await renderRecoveredPanel(snapshotWith([]));

    await act(async () => {
      await result.current.submitConversationMessageAction(
        "用这个技能生成",
        undefined,
        "cs_ugc_ads_video",
      );
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      "1",
      "用这个技能生成",
      "cmd-id",
      "cmd-id",
      undefined,
      undefined,
      "cs_ugc_ads_video",
    );
  });

  it("有活动澄清时 forced 被屏蔽（reply 互斥），不透传 forced_creative_skill_id", async () => {
    const { result } = await renderRecoveredPanel(
      snapshotWith([awaitingClarificationRun]),
    );

    await act(async () => {
      await result.current.submitConversationMessageAction(
        "水墨风格",
        undefined,
        "cs_ugc_ads_video",
      );
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      "1",
      "水墨风格",
      "cmd-id",
      "cmd-id",
      42,
      undefined,
      undefined,
    );
  });
});

describe("useCanvasProjects ?project 初始定位（/generate「打开项目」闭环）", () => {
  it("超过安全整数的 Project ID 在 recovery 与消息命令中保持精确字符串", async () => {
    const huge = "9007199254740993";
    vi.mocked(listProjects).mockResolvedValue([
      { id: huge, name: "大 ID 项目", thumb: null, created_at: "2026-07-17" },
    ]);

    const { result } = renderHook(() => useCanvasProjects(huge));
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    await waitFor(() =>
      expect(vi.mocked(runProjectRecovery)).toHaveBeenCalledWith(
        huge,
        expect.anything(),
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );

    await act(async () => {
      await result.current.submitConversationMessageAction("保持精确 ID");
    });

    expect(vi.mocked(acceptConversationMessage)).toHaveBeenCalledWith(
      huge,
      "保持精确 ID",
      "cmd-id",
      "cmd-id",
      undefined,
      undefined,
      undefined,
    );
  });

  it("preferred id 存在于列表时 active 切到该项目；只应用一次，手动切换不被弹回", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 1, name: "demo", thumb: null, created_at: "2026-07-17" },
      { id: 2, name: "目标项目", thumb: null, created_at: "2026-07-17" },
    ]);

    const { result } = renderHook(() => useCanvasProjects("2"));
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    await waitFor(() => expect(result.current.activeProject.id).toBe("2"));

    // 参数应用后用户仍可自由切换（不被 URL 参数弹回）
    act(() => result.current.switchProject("1"));
    expect(result.current.activeProject.id).toBe("1");
  });

  it("preferred id 不存在于列表时忽略参数，active 保持首项（回退现行为）", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 1, name: "demo", thumb: null, created_at: "2026-07-17" },
    ]);

    const { result } = renderHook(() => useCanvasProjects("999"));
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    // 给一次性定位 effect 一个应用窗口后仍应保持首项
    await waitFor(() =>
      expect(vi.mocked(runProjectRecovery)).toHaveBeenCalled(),
    );
    expect(result.current.activeProject.id).toBe("1");
  });

  it("无 preferred id 时行为不变：active 为列表首项", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: 1, name: "demo", thumb: null, created_at: "2026-07-17" },
      { id: 2, name: "second", thumb: null, created_at: "2026-07-17" },
    ]);

    const { result } = renderHook(() => useCanvasProjects());
    await waitFor(() => expect(result.current.backendReady).toBe(true));
    expect(result.current.activeProject.id).toBe("1");
  });
});

describe("useCanvasProjects 删除项目二次确认（IK25EG）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue([
      { id: 1, name: "demo", thumb: null, created_at: "2026-07-17" },
      { id: 2, name: "second", thumb: null, created_at: "2026-07-17" },
    ]);
  });

  it("确认永久删除后调用删除接口并移除项目", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderHook(() => useCanvasProjects());
    await waitFor(() => expect(result.current.backendReady).toBe(true));

    await act(async () => {
      await result.current.deleteProjectAction("1");
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(vi.mocked(deleteProject)).toHaveBeenCalledWith(1);
    expect(
      result.current.state.projects.find((p) => p.id === "1"),
    ).toBeUndefined();
    expect(
      result.current.state.projects.find((p) => p.id === "2"),
    ).toBeDefined();
    confirmSpy.mockRestore();
  });

  it("取消确认则不调用删除接口，项目保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useCanvasProjects());
    await waitFor(() => expect(result.current.backendReady).toBe(true));

    await act(async () => {
      await result.current.deleteProjectAction("1");
    });

    expect(vi.mocked(deleteProject)).not.toHaveBeenCalled();
    expect(
      result.current.state.projects.find((p) => p.id === "1"),
    ).toBeDefined();
    confirmSpy.mockRestore();
  });
});
