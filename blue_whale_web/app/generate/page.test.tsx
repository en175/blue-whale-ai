// @vitest-environment jsdom
/**
 * /generate 对话式创作页组件测试（IK21O9 验收点 a–e）。
 *
 * 所有后端请求层（generation-inbox / assets / canvas / command-identity）与
 * runProjectRecovery 均 mock；Snapshot 经捕获的 onState 回调注入，模拟恢复闭环。
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInboxConversation,
  deleteGenerationInbox,
  getGenerationInbox,
  listInboxConversations,
  postInboxMessage,
} from "@/lib/generation-inbox";
import { copyAssetToProject } from "@/lib/assets";
import { listProjects } from "@/lib/canvas";
import { newCommandIdentity } from "@/lib/command-identity";
import { runProjectRecovery } from "@/lib/project-recovery";
import type {
  ProjectRecoveryState,
  ProjectSnapshot,
} from "@/lib/project-recovery";
import GeneratePage from "./page";

vi.mock("@/lib/generation-inbox", () => ({
  getGenerationInbox: vi.fn(),
  postInboxMessage: vi.fn(),
  listInboxConversations: vi.fn(),
  createInboxConversation: vi.fn(),
  deleteGenerationInbox: vi.fn(),
}));
vi.mock("@/lib/assets", () => ({ copyAssetToProject: vi.fn() }));
vi.mock("@/lib/canvas", () => ({
  listProjects: vi.fn(),
  renameProject: vi.fn(),
}));
vi.mock("@/lib/command-identity", () => ({
  newCommandIdentity: vi.fn(() => "cmd-id"),
}));
vi.mock("@/lib/api-client", () => ({
  apiFetch: vi.fn(async () => new Response(new Blob(["img"]))),
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

const INBOX = {
  project: {
    id: 42,
    name: "生成收件箱",
    thumb: null,
    created_at: "2026-07-19T08:00:00Z",
    purpose: "generation_inbox",
  },
  active_conversation_id: 2,
};

function snapshotWith(
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot {
  return {
    project: {
      id: 42,
      name: "生成收件箱",
      thumb: null,
      created_at: "2026-07-19T08:00:00Z",
    },
    canvas: { id: null, project_id: 42, viewport: null, nodes: null },
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: 10,
    ...overrides,
  };
}

function recoveryState(snapshot: ProjectSnapshot): ProjectRecoveryState {
  return {
    projectId: 42,
    snapshot,
    lastCursor: snapshot.high_watermark_cursor,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
  };
}

/** 等恢复闭环建立后注入 Snapshot（模拟 Snapshot + SSE 恢复）。 */
async function feedSnapshot(snapshot: ProjectSnapshot) {
  await waitFor(() => expect(vi.mocked(runProjectRecovery)).toHaveBeenCalled());
  const onState = vi.mocked(runProjectRecovery).mock.calls[0][2];
  act(() => onState(recoveryState(snapshot)));
}

describe("/generate 对话式创作页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/generate");
  });

  it("a) 无收件箱：渲染空态且全程无创建类请求", async () => {
    vi.mocked(getGenerationInbox).mockResolvedValue(null);

    render(<GeneratePage />);

    await screen.findByText("让 Agent 帮你创作");
    expect(screen.getByLabelText("消息输入框")).toBeInTheDocument();
    expect(getGenerationInbox).toHaveBeenCalledTimes(1);
    // 打开页面绝不发创建请求
    expect(postInboxMessage).not.toHaveBeenCalled();
    expect(createInboxConversation).not.toHaveBeenCalled();
    expect(deleteGenerationInbox).not.toHaveBeenCalled();
    expect(listInboxConversations).not.toHaveBeenCalled();
    expect(runProjectRecovery).not.toHaveBeenCalled();
  });

  it("b) 空态发送首条消息：调用 inbox messages 端点（不带 conversation_id）并进入对话态", async () => {
    vi.mocked(getGenerationInbox)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...INBOX, active_conversation_id: 7 });
    vi.mocked(postInboxMessage).mockResolvedValue({
      project_id: 42,
      conversation_id: 7,
      message_id: 100,
      agent_run_id: 50,
      accepted_cursor: 1,
    });

    render(<GeneratePage />);
    await screen.findByText("让 Agent 帮你创作");

    fireEvent.change(screen.getByLabelText("消息输入框"), {
      target: { value: "生成一只蓝鲸" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() =>
      expect(postInboxMessage).toHaveBeenCalledWith({
        content: "生成一只蓝鲸",
        clientMessageId: "cmd-id",
        idempotencyKey: "cmd-id",
      }),
    );
    // 202 后重拉收件箱进入对话态，并对收件箱 Project 建立恢复闭环
    await screen.findByRole("button", { name: "新对话" });
    expect(getGenerationInbox).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(vi.mocked(runProjectRecovery)).toHaveBeenCalledWith(
        42,
        expect.anything(),
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
  });

  it("c) 有收件箱：按 active_conversation_id 过滤消息渲染", async () => {
    vi.mocked(getGenerationInbox).mockResolvedValue(INBOX);

    render(<GeneratePage />);
    await screen.findByRole("button", { name: "新对话" });

    await feedSnapshot(
      snapshotWith({
        conversation_messages: [
          {
            message_id: 1,
            conversation_id: 1,
            role: "user",
            content: "一会话的消息",
            sequence_no: 1,
          },
          {
            message_id: 2,
            conversation_id: 2,
            role: "user",
            content: "二会话的消息",
            sequence_no: 1,
          },
          {
            message_id: 3,
            conversation_id: 2,
            role: "assistant",
            content: "二会话的回复",
            sequence_no: 2,
          },
        ],
      }),
    );

    expect(screen.getByText("二会话的消息")).toBeInTheDocument();
    expect(screen.getByText("二会话的回复")).toBeInTheDocument();
    expect(screen.queryByText("一会话的消息")).not.toBeInTheDocument();
  });

  it("d) 删除收件箱：二次确认后才发 DELETE，成功后回空态", async () => {
    vi.mocked(getGenerationInbox).mockResolvedValue(INBOX);
    vi.mocked(deleteGenerationInbox).mockResolvedValue(undefined);

    render(<GeneratePage />);
    await screen.findByRole("button", { name: "新对话" });

    // 第一次：打开确认框 → 取消，不发 DELETE
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByRole("dialog", { name: "删除生成收件箱" });
    expect(
      screen.getByText(/永久删除收件箱及全部对话、生成任务与作品/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(deleteGenerationInbox).not.toHaveBeenCalled();

    // 第二次：确认永久删除 → 发 DELETE → 回空态
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await screen.findByRole("dialog", { name: "删除生成收件箱" });
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(deleteGenerationInbox).toHaveBeenCalledTimes(1));
    await screen.findByText("让 Agent 帮你创作");
  });

  it("e) 添加到项目：对话框选择目标项目后调用复制端点并给出打开项目链接", async () => {
    vi.mocked(getGenerationInbox).mockResolvedValue({
      ...INBOX,
      active_conversation_id: 1,
    });
    vi.mocked(listProjects).mockResolvedValue([
      { id: 77, name: "我的项目", thumb: null, created_at: "2026-07-18" },
    ]);
    vi.mocked(copyAssetToProject).mockResolvedValue({
      id: 101,
      type: "image",
      url: "/assets/101/content",
      width: 1024,
      height: 1024,
      duration: null,
      source: "generated",
      created_at: "2026-07-19T09:00:00Z",
    });

    render(<GeneratePage />);
    await screen.findByRole("button", { name: "新对话" });

    await feedSnapshot(
      snapshotWith({
        conversation_messages: [
          {
            message_id: 1,
            conversation_id: 1,
            role: "user",
            content: "生成蓝鲸",
            sequence_no: 1,
          },
        ],
        agent_runs: [{ agent_run_id: 5, conversation_id: 1 }],
        generation_jobs: [
          {
            job_id: 9,
            type: "image",
            source: "agent_run",
            agent_run_id: 5,
            status: "succeeded",
            input: { prompt: "蓝鲸" },
            outputs: [{ slot_index: 0, status: "succeeded", asset_id: 9 }],
          },
        ],
        assets: {
          "9": {
            asset_id: 9,
            type: "image",
            access_url: "/api/projects/42/assets/9/content",
          },
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "添加到项目" }));
    const dialog = await screen.findByRole("dialog", { name: "添加到项目" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "我的项目" }));
    await waitFor(() =>
      expect(copyAssetToProject).toHaveBeenCalledWith(77, "9", "cmd-id"),
    );
    await screen.findByText(/已添加到/);
    expect(screen.getByRole("link", { name: "打开项目" })).toHaveAttribute(
      "href",
      "/canvas?project=77",
    );
  });

  it("f) 发送失败后重试（文本未改）复用同一 client/幂等键", async () => {
    let seq = 0;
    vi.mocked(newCommandIdentity).mockImplementation(() => `cmd-${++seq}`);
    try {
      vi.mocked(getGenerationInbox)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ...INBOX, active_conversation_id: 7 });
      vi.mocked(postInboxMessage)
        .mockRejectedValueOnce(new Error("网络错误"))
        .mockResolvedValue({
          project_id: 42,
          conversation_id: 7,
          message_id: 100,
          agent_run_id: 50,
          accepted_cursor: 1,
        });

      render(<GeneratePage />);
      await screen.findByText("让 Agent 帮你创作");

      fireEvent.change(screen.getByLabelText("消息输入框"), {
        target: { value: "生成一只蓝鲸" },
      });
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
      await screen.findByText("网络错误");

      // 失败后草稿保留，直接重发：必须复用首次的 client/幂等键（防重复消息）
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
      await waitFor(() =>
        expect(vi.mocked(postInboxMessage)).toHaveBeenCalledTimes(2),
      );
      const first = vi.mocked(postInboxMessage).mock.calls[0][0];
      const second = vi.mocked(postInboxMessage).mock.calls[1][0];
      expect(second.clientMessageId).toBe(first.clientMessageId);
      expect(second.idempotencyKey).toBe(first.idempotencyKey);
    } finally {
      vi.mocked(newCommandIdentity).mockImplementation(() => "cmd-id");
    }
  });

  it("g) 添加到项目失败后重试复用同一幂等键", async () => {
    let seq = 0;
    vi.mocked(newCommandIdentity).mockImplementation(() => `cmd-${++seq}`);
    try {
      vi.mocked(getGenerationInbox).mockResolvedValue({
        ...INBOX,
        active_conversation_id: 1,
      });
      vi.mocked(listProjects).mockResolvedValue([
        { id: 77, name: "我的项目", thumb: null, created_at: "2026-07-18" },
      ]);
      vi.mocked(copyAssetToProject)
        .mockRejectedValueOnce(new Error("网络错误"))
        .mockResolvedValue({
          id: 101,
          type: "image",
          url: "/assets/101/content",
          width: 1024,
          height: 1024,
          duration: null,
          source: "generated",
          created_at: "2026-07-19T09:00:00Z",
        });

      render(<GeneratePage />);
      await screen.findByRole("button", { name: "新对话" });

      await feedSnapshot(
        snapshotWith({
          conversation_messages: [
            {
              message_id: 1,
              conversation_id: 1,
              role: "user",
              content: "生成蓝鲸",
              sequence_no: 1,
            },
          ],
          agent_runs: [{ agent_run_id: 5, conversation_id: 1 }],
          generation_jobs: [
            {
              job_id: 9,
              type: "image",
              source: "agent_run",
              agent_run_id: 5,
              status: "succeeded",
              input: { prompt: "蓝鲸" },
              outputs: [{ slot_index: 0, status: "succeeded", asset_id: 9 }],
            },
          ],
          assets: {
            "9": {
              asset_id: 9,
              type: "image",
              access_url: "/api/projects/42/assets/9/content",
            },
          },
        }),
      );

      fireEvent.click(
        await screen.findByRole("button", { name: "添加到项目" }),
      );
      await screen.findByRole("dialog", { name: "添加到项目" });

      // 第一次复制失败 → 对话框内重试同一目标项目：复用同一幂等键（防重复副本）
      fireEvent.click(await screen.findByRole("button", { name: "我的项目" }));
      await screen.findByText("网络错误");
      fireEvent.click(screen.getByRole("button", { name: "我的项目" }));
      await screen.findByText(/已添加到/);

      expect(vi.mocked(copyAssetToProject)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(copyAssetToProject).mock.calls[1][2]).toBe(
        vi.mocked(copyAssetToProject).mock.calls[0][2],
      );
    } finally {
      vi.mocked(newCommandIdentity).mockImplementation(() => "cmd-id");
    }
  });
});
