// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChatPanel } from "./AgentChatPanel";
import { ApiError } from "@/lib/api/errors";
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

function planCardMessage(): ChatMessage {
  return {
    id: "plan-message-7",
    type: "plan-card",
    text: "# 冻结正文\n一只蓝鲸跃出海面",
    meta: "图片生成计划",
    planMessageId: 7,
    sequenceLabel: "Scene 1 · Shot 2",
    appliedAt: null,
    applicationAvailability: "available",
    firstGenerationJobId: null,
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof AgentChatPanel>> = {},
) {
  return render(
    <AgentChatPanel
      messages={[planCardMessage()]}
      isOpen
      onClose={() => {}}
      {...props}
    />,
  );
}

describe("AgentChatPanel 计划卡手动应用（IK6KQB）", () => {
  afterEach(cleanup);

  it("请求成功后继续等待 SSE；期间重复点击不发第二个请求", async () => {
    let resolveApply!: (value: unknown) => void;
    const onApplyPlanMessage = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        }),
    );
    renderPanel({ onApplyPlanMessage });

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));
    // 请求进行中：按钮禁用显示「应用中…」，重复点击不再触发
    expect(screen.getByText("应用中…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

    expect(onApplyPlanMessage).toHaveBeenCalledTimes(1);
    expect(onApplyPlanMessage).toHaveBeenCalledWith(7);

    await act(async () => {
      resolveApply({});
      await Promise.resolve();
    });

    expect(screen.getByText("应用中…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("应用中…"));
    expect(onApplyPlanMessage).toHaveBeenCalledTimes(1);
  });

  it("余额不足（100405）：卡片进入 retryable_blocked，按钮恢复可点", async () => {
    const onApplyPlanMessage = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ status: 200, code: "100405", message: "余额不足" }),
      );
    renderPanel({ onApplyPlanMessage });

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

    await waitFor(() =>
      expect(screen.getByText("余额不足")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "手动应用" })).toBeEnabled();
  });

  it("余额不足后重试：新请求发起即清除错误态", async () => {
    const onApplyPlanMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ status: 200, code: "100405", message: "余额不足" }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // 永不 resolve：观察请求进行中的瞬时态
          }),
      );
    renderPanel({ onApplyPlanMessage });

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));
    await waitFor(() =>
      expect(screen.getByText("余额不足")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

    await waitFor(() =>
      expect(screen.queryByText("余额不足")).not.toBeInTheDocument(),
    );
    expect(onApplyPlanMessage).toHaveBeenCalledTimes(2);
    expect(screen.getByText("应用中…")).toBeInTheDocument();
  });

  it.each(["100403", "100202", "100407"])(
    "计划失效（%s）：卡片进入 requires_new_plan，按钮置灰",
    async (code) => {
      const onApplyPlanMessage = vi
        .fn()
        .mockRejectedValue(
          new ApiError({ status: 200, code, message: "计划已失效" }),
        );
      renderPanel({ onApplyPlanMessage });

      fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

      await waitFor(() =>
        expect(screen.getByText("需新计划")).toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: "手动应用" })).toBeDisabled();
      expect(screen.getByText("计划已失效，请重新生成")).toBeInTheDocument();
    },
  );

  it("未知错误：不伪造错误态，恢复可操作", async () => {
    const onApplyPlanMessage = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ status: 500, code: "http_500", message: "服务器错误" }),
      );
    renderPanel({ onApplyPlanMessage });

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "手动应用" })).toBeEnabled(),
    );
    expect(screen.getByText("可应用")).toBeInTheDocument();
    expect(screen.queryByText("余额不足")).not.toBeInTheDocument();
  });
});
