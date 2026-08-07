// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import type { ChatMessage } from "../types";
import { PlanCard } from "./ChatBubbles";

expect.extend(jestDomMatchers);

type PlanCardMessage = Extract<ChatMessage, { type: "plan-card" }>;

function planCard(overrides: Partial<PlanCardMessage>): PlanCardMessage {
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
    ...overrides,
  };
}

describe("PlanCard 冻结计划卡渲染（IK6KQ2）", () => {
  afterEach(() => cleanup());

  it("未应用 + available：显示分镜序号、可用性徽标与启用的手动应用按钮", () => {
    render(<PlanCard msg={planCard({})} />);

    expect(screen.getByText("Scene 1 · Shot 2")).toBeInTheDocument();
    expect(screen.getByText("可应用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动应用" })).toBeEnabled();
    expect(screen.getByText("一只蓝鲸跃出海面")).toBeInTheDocument();
  });

  it("未应用 + requires_new_plan：按钮置灰并提示重新生成", () => {
    render(
      <PlanCard
        msg={planCard({ applicationAvailability: "requires_new_plan" })}
      />,
    );

    expect(screen.getByText("需新计划")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动应用" })).toBeDisabled();
    expect(screen.getByText("计划已失效，请重新生成")).toBeInTheDocument();
  });

  it("已应用 + available：显示已应用徽标且无手动应用按钮", () => {
    render(<PlanCard msg={planCard({ appliedAt: "2026-08-02T00:00:00" })} />);

    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "手动应用" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("计划已失效，请重新生成"),
    ).not.toBeInTheDocument();
  });

  it("已应用 + requires_new_plan：权威可用性不被已应用遮蔽", () => {
    render(
      <PlanCard
        msg={planCard({
          appliedAt: "2026-08-02T00:00:00",
          applicationAvailability: "requires_new_plan",
        })}
      />,
    );

    expect(screen.getByText("需新计划")).toBeInTheDocument();
    expect(screen.getByText("计划已失效，请重新生成")).toBeInTheDocument();
    expect(screen.queryByText("已应用")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "手动应用" }),
    ).not.toBeInTheDocument();
  });
});

describe("PlanCard 手动应用接线（IK6KQB）", () => {
  afterEach(() => cleanup());

  it("点击手动应用触发 onApply 一次，携带计划卡消息", () => {
    const onApply = vi.fn();
    render(<PlanCard msg={planCard({})} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "手动应用" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ planMessageId: 7 }),
    );
  });

  it("applying 中：按钮禁用并显示应用中", () => {
    render(<PlanCard msg={planCard({})} applying onApply={vi.fn()} />);

    expect(screen.getByRole("button", { name: "手动应用" })).toBeDisabled();
    expect(screen.getByText("应用中…")).toBeInTheDocument();
  });

  it("retryable_blocked：显示余额不足提示，按钮保持可点（可重试）", () => {
    render(
      <PlanCard
        msg={planCard({ applicationAvailability: "retryable_blocked" })}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByText("余额不足")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动应用" })).toBeEnabled();
  });
});
