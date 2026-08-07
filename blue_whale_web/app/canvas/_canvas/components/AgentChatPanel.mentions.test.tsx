// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { AgentChatPanel } from "./AgentChatPanel";

vi.mock("@/components/auth/AuthContext", () => ({
  useAuth: () => ({
    requireAuth: (_context: unknown, proceed: () => void) => proceed(),
  }),
}));

vi.mock("@/components/skill/SkillPanel", () => ({ default: () => null }));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", FakeResizeObserver);

Object.defineProperty(window.HTMLElement.prototype, "innerText", {
  get() {
    return this.textContent ?? "";
  },
  set(value: string) {
    this.textContent = value;
  },
  configurable: true,
});

afterEach(cleanup);

describe("AgentChatPanel 显式引用接纳", () => {
  it("按输入区顺序提交统一 mentions，失败后保留、标记并允许移除 pill", async () => {
    const onSubmitMessage = vi.fn().mockRejectedValue(
      new ApiError({
        status: 202,
        code: "mention.unavailable",
        message: "引用不可用",
        detail: {
          code: "mention.unavailable",
          message: "一个或多个引用不可用",
          mentions: [{ index: 0, type: "scene_card", reason: "stale" }],
        },
      }),
    );
    render(
      <AgentChatPanel
        messages={[]}
        isOpen
        onClose={() => {}}
        onSubmitMessage={onSubmitMessage}
      />,
    );
    const editor = document.querySelector<HTMLElement>(
      ".tc-agent-composer-editor",
    )!;
    editor.innerHTML =
      '<span data-mention-id="scene-12" data-mention-name="开场分镜" data-mention-type="scene_card" data-mention-scene-card-id="12" data-mention-scene-card-version="3" contenteditable="false">开场分镜</span> 请沿用';
    fireEvent.input(editor);
    fireEvent.click(screen.getByLabelText("发送"));

    await waitFor(() => expect(onSubmitMessage).toHaveBeenCalledTimes(1));
    expect(onSubmitMessage).toHaveBeenCalledWith(
      "@[开场分镜] 请沿用",
      [
        {
          type: "scene_card",
          scene_card_id: "12",
          scene_card_version: 3,
          display_name: "开场分镜",
        },
      ],
      undefined,
      undefined,
    );
    const marked = await waitFor(() => {
      const pill = editor.querySelector<HTMLElement>(
        '[data-mention-availability="unavailable"]',
      );
      expect(pill).not.toBeNull();
      return pill!;
    });
    expect(marked.getAttribute("data-mention-reason")).toBe("stale");
    fireEvent.click(screen.getByLabelText("移除失效引用 开场分镜"));
    expect(editor.querySelector('[data-mention-id="scene-12"]')).toBeNull();
  });
});
