// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChatPanel } from "./AgentChatPanel";

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

describe("AgentChatPanel 「直接使用」技能标签", () => {
  afterEach(cleanup);

  it("点「使用」后输入框区域出现可移除技能标签", () => {
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

    const tag = screen.getByTestId("direct-skill-tag");
    expect(tag.textContent).toContain("海报专家");
  });

  it("点移除按钮清除技能标签与 pending 绑定", () => {
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
    fireEvent.click(screen.getByLabelText("移除技能标签"));

    expect(screen.queryByTestId("direct-skill-tag")).toBeNull();
    expect(screen.queryByLabelText("已选技能：海报专家")).toBeNull();
  });
});
