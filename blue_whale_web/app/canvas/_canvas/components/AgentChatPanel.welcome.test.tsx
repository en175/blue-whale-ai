// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatPanel } from "./AgentChatPanel";
import type { ChatMessage } from "../types";

vi.mock("@/components/auth/AuthContext", () => ({
  useAuth: () => ({
    requireAuth: (_context: unknown, proceed: () => void) => proceed(),
  }),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", FakeResizeObserver);

// jsdom 未实现 innerText：映射到 textContent，满足 composer 读写语义
Object.defineProperty(window.HTMLElement.prototype, "innerText", {
  get() {
    return this.textContent ?? "";
  },
  set(value: string) {
    this.textContent = value;
  },
  configurable: true,
});

function renderPanel(
  props: Partial<React.ComponentProps<typeof AgentChatPanel>> = {},
) {
  const onSubmitMessage = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <AgentChatPanel
      messages={[]}
      isOpen
      onClose={() => {}}
      onSubmitMessage={onSubmitMessage}
      {...props}
    />,
  );
  return { onSubmitMessage, ...utils };
}

const composerEditor = () =>
  document.querySelector<HTMLDivElement>(".tc-agent-composer-editor");

describe("AgentChatPanel 欢迎态与草稿（IK67GD T02）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("空消息显示欢迎态与预设按钮", () => {
    renderPanel();
    expect(document.querySelector(".tc-agent-welcome")).toBeTruthy();
    expect(screen.getAllByText("让 Agent 帮你创作").length).toBeGreaterThan(0);
    expect(
      document.querySelectorAll(".tc-agent-welcome-preset").length,
    ).toBeGreaterThan(0);
  });

  it("已有消息时不显示欢迎态", () => {
    const messages: ChatMessage[] = [{ id: "m1", type: "user", text: "你好" }];
    renderPanel({ messages });
    expect(document.querySelector(".tc-agent-welcome")).toBeNull();
  });

  it("显示最新 Run 的 Skill，思考摘要折叠为「思考过程」", () => {
    renderPanel({
      activeSkillName: "海报专家",
      agentRunStatus: "completed",
      reasoningSummary: "已使用「海报专家」完成回答。",
    });

    expect(screen.getByLabelText("已激活技能：海报专家")).toBeTruthy();
    // 头部不再展示 Run 状态；思考摘要折叠在对话流末尾，展开后可见
    expect(screen.queryByText("已使用「海报专家」完成回答。")).toBeNull();
    fireEvent.click(screen.getByText("思考过程"));
    expect(screen.getByText("已使用「海报专家」完成回答。")).toBeTruthy();
  });

  it("把尚未发送的 forced Skill 标记为已选而非已激活", () => {
    renderPanel({
      skillRecommendations: [
        {
          creative_skill_id: "official.poster",
          name: "海报专家",
          description: "生成海报",
          activation_eligibility: "requires_user_use",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "使用" }));

    expect(screen.getByLabelText("已选技能：海报专家")).toBeTruthy();
    expect(screen.queryByLabelText("已激活技能：海报专家")).toBeNull();
  });

  it("点预设只填入输入框，不发送、不创建产品事实", () => {
    const { onSubmitMessage } = renderPanel();
    const preset = document.querySelector<HTMLButtonElement>(
      ".tc-agent-welcome-preset",
    );
    expect(preset).toBeTruthy();
    fireEvent.click(preset!);

    expect(composerEditor()!.innerText.trim().length).toBeGreaterThan(0);
    expect(onSubmitMessage).not.toHaveBeenCalled();
    // 发送按钮可用但未被触发
    expect(screen.getByLabelText("发送")).not.toBeDisabled();
  });

  it("输入草稿写入 localStorage；重新挂载后恢复", () => {
    renderPanel({ projectId: "p1" });
    fireEvent.input(composerEditor()!, {
      target: { innerText: "未发送的草稿" },
    });
    expect(
      window.localStorage.getItem("blue-whale:canvas-composer-draft:p1"),
    ).toBe("未发送的草稿");

    cleanup();
    renderPanel({ projectId: "p1" });
    expect(composerEditor()!.innerText).toContain("未发送的草稿");
    expect(screen.getByLabelText("发送")).not.toBeDisabled();
  });

  it("草稿按 projectId 隔离，切项目不串扰", () => {
    renderPanel({ projectId: "p1" });
    fireEvent.input(composerEditor()!, { target: { innerText: "甲草稿" } });
    cleanup();

    renderPanel({ projectId: "p2" });
    expect(composerEditor()!.innerText).toBe("");
  });

  it("面板以收起态挂载、之后展开时草稿仍恢复（真实浏览器主路径）", () => {
    window.localStorage.setItem(
      "blue-whale:canvas-composer-draft:p1",
      "收起前留下的草稿",
    );
    const onSubmitMessage = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <AgentChatPanel
        messages={[]}
        isOpen={false}
        onClose={() => {}}
        projectId="p1"
        onSubmitMessage={onSubmitMessage}
      />,
    );
    rerender(
      <AgentChatPanel
        messages={[]}
        isOpen
        onClose={() => {}}
        projectId="p1"
        onSubmitMessage={onSubmitMessage}
      />,
    );
    expect(composerEditor()!.innerText).toContain("收起前留下的草稿");
    expect(screen.getByLabelText("发送")).not.toBeDisabled();
  });

  it("发送成功后清除草稿", async () => {
    const { onSubmitMessage } = renderPanel({ projectId: "p1" });
    fireEvent.input(composerEditor()!, {
      target: { innerText: "要发送的内容" },
    });
    expect(
      window.localStorage.getItem("blue-whale:canvas-composer-draft:p1"),
    ).toBe("要发送的内容");

    fireEvent.click(screen.getByLabelText("发送"));

    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        window.localStorage.getItem("blue-whale:canvas-composer-draft:p1"),
      ).toBeNull(),
    );
    expect(composerEditor()!.innerText).toBe("");
  });
});
