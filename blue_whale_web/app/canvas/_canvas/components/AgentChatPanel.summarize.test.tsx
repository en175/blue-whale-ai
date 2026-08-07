// @vitest-environment jsdom
/** AgentChatPanel「总结当前对话」链路（IK60X1，契约 §15.1）：
 *  入口点击 → 关面板 + 预填固定提示词（可编辑、必须手动发送）；
 *  发送时 onSubmitMessage 携带 skillSummarize=true，一次性消费（成功清除、失败保留）。 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatPanel } from "./AgentChatPanel";

vi.mock("@/components/auth/AuthContext", () => ({
  useAuth: () => ({
    requireAuth: (_context: unknown, proceed: () => void) => proceed(),
  }),
}));

// SkillPanel 打桩：只暴露本链路依赖的「总结当前对话」入口与开关联动
vi.mock("@/components/SkillPanel", async () => {
  const React = await import("react");
  return {
    default: ({
      isOpen,
      onSummarizeConversation,
    }: {
      isOpen: boolean;
      onSummarizeConversation?: () => void;
    }) =>
      isOpen
        ? React.createElement(
            "button",
            {
              type: "button",
              "data-testid": "skill-summarize-entry",
              onClick: onSummarizeConversation,
            },
            "总结当前对话",
          )
        : null,
  };
});

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

function openSkillPanelAndSummarize() {
  fireEvent.click(screen.getByLabelText("技能"));
  const entry = screen.getByTestId("skill-summarize-entry");
  fireEvent.click(entry);
}

describe("AgentChatPanel 总结当前对话（IK60X1）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(cleanup);

  it("点击入口：关面板、预填固定提示词、不自动发送、发送按钮可用", () => {
    const { onSubmitMessage } = renderPanel();

    openSkillPanelAndSummarize();

    // 面板关闭（入口随之卸载）
    expect(screen.queryByTestId("skill-summarize-entry")).toBeNull();
    // 固定提示词预填，明确表达「总结当前对话并保存为我的个人技能」
    expect(composerEditor()!.innerText).toContain("总结当前对话");
    expect(composerEditor()!.innerText).toContain("保存为我的个人技能");
    // 不自动发送
    expect(onSubmitMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText("发送")).not.toBeDisabled();
  });

  it("预填内容可编辑，手动发送携带 skillSummarize=true，第二条消息不再携带", async () => {
    const { onSubmitMessage } = renderPanel();

    openSkillPanelAndSummarize();
    fireEvent.input(composerEditor()!, {
      target: { innerText: "总结这段对话里的海报方法论，存成我的技能" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalledTimes(1));
    expect(onSubmitMessage).toHaveBeenNthCalledWith(
      1,
      "总结这段对话里的海报方法论，存成我的技能",
      [],
      undefined,
      true,
    );

    // 一次性消费：第二条普通消息不带总结意图
    fireEvent.input(composerEditor()!, { target: { innerText: "再来一张" } });
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalledTimes(2));
    expect(onSubmitMessage).toHaveBeenNthCalledWith(
      2,
      "再来一张",
      [],
      undefined,
      undefined,
    );
  });

  it("发送失败时保留意图标记，重试仍携带 skillSummarize=true", async () => {
    const onSubmitMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(undefined);
    render(
      <AgentChatPanel
        messages={[]}
        isOpen
        onClose={() => {}}
        onSubmitMessage={onSubmitMessage}
      />,
    );

    openSkillPanelAndSummarize();
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalledTimes(1));

    // 失败后 composer 内容保留（未清空），直接重试
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalledTimes(2));
    expect(onSubmitMessage.mock.calls[1][3]).toBe(true);
  });
});
