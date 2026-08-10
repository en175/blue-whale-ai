// @vitest-environment jsdom
/**
 * AgentCard 单测（IK7GS4）：权威对话卡「手动应用」直插入口下线的回归覆盖。
 *
 * 权威卡（带 generationJobId）normal 成功态：按钮禁用 + 说明文案「已自动放置」+ 不触发 onReapply。
 * DEMO/mock 卡（无 generationJobId）normal 态：按钮可点击 + aria-label「手动应用」+ 点击触发 onReapply。
 * 失败卡：按钮可点击 + aria-label「生成失败，可重试」（行为不变）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "./ChatBubbles";
import type { ChatMessage } from "../types";

afterEach(cleanup);

type CardMsg = Extract<ChatMessage, { type: "card" }>;

/** 权威成功卡：后端 GenerationJob 投影（conversationRecovery 恒带 generationJobId + assetId）。 */
function authoritativeCard(over: Partial<CardMsg> = {}): CardMsg {
  return {
    id: "generation-job-42-slot-0",
    type: "card",
    text: "鲸鱼，水墨风格",
    meta: "图片生成",
    status: "normal",
    generationJobId: 42,
    slotIndex: 0,
    assetId: "asset-1",
    ...over,
  };
}

/** DEMO/mock 成功卡：buildMockReply 产出，无 generationJobId/assetId。 */
function demoCard(over: Partial<CardMsg> = {}): CardMsg {
  return {
    id: 100,
    type: "card",
    text: "一只猫（已生成图片卡片）",
    meta: "1:1",
    status: "normal",
    ...over,
  };
}

describe("AgentCard 手动应用入口（IK7GS4）", () => {
  it("权威 normal 卡：按钮禁用、aria-label 为「已自动放置」、点击不触发 onReapply", () => {
    const onReapply = vi.fn();
    render(<AgentCard msg={authoritativeCard()} onReapply={onReapply} />);

    const cta = screen.getByRole("button", { name: "已自动放置" });
    expect(cta).toBeDisabled();

    fireEvent.click(cta);
    expect(onReapply).not.toHaveBeenCalled();
  });

  it("DEMO normal 卡：按钮可点击、aria-label 为「手动应用」、点击触发 onReapply", () => {
    const onReapply = vi.fn();
    render(<AgentCard msg={demoCard()} onReapply={onReapply} />);

    const cta = screen.getByRole("button", { name: "手动应用" });
    expect(cta).not.toBeDisabled();

    fireEvent.click(cta);
    expect(onReapply).toHaveBeenCalledTimes(1);
    expect(onReapply.mock.calls[0][0]).toMatchObject({ id: 100 });
  });

  it("失败卡：按钮可点击、aria-label 为「生成失败，可重试」、点击触发 onReapply", () => {
    const onReapply = vi.fn();
    render(
      <AgentCard
        msg={authoritativeCard({
          status: "failed",
          errorMessage: "图像生成失败",
        })}
        onReapply={onReapply}
      />,
    );

    const cta = screen.getByRole("button", { name: "生成失败，可重试" });
    expect(cta).not.toBeDisabled();

    fireEvent.click(cta);
    expect(onReapply).toHaveBeenCalledTimes(1);
  });

  it("权威生成中卡（status=generating）：按钮禁用（生成中不变量）", () => {
    render(<AgentCard msg={authoritativeCard({ status: "generating" })} />);
    expect(screen.getByRole("button", { name: "手动应用" })).toBeDisabled();
  });
});
