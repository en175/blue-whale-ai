// @vitest-environment jsdom
/** SkillPanel「总结当前对话」入口（IK60X1，契约 §15.1）：
 *  入口始终可用、仅宿主传入回调时渲染（首页/generate 不传 → 不渲染）；
 *  脏草稿时点击入口沿用 confirmDirtyClose 守卫。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillPanel from "./SkillPanel";

vi.mock("@/components/api/skills", () => ({
  skillsApi: {
    library: vi
      .fn()
      .mockResolvedValue({ records: [], total: 0, current: 1, size: 50 }),
    mine: vi
      .fn()
      .mockResolvedValue({ records: [], total: 0, current: 1, size: 50 }),
    add: vi.fn(),
    remove: vi.fn(),
    setAuto: vi.fn(),
    createPersonalSkill: vi.fn(),
    formatSkillDraft: vi.fn(),
    getPersonalSkill: vi.fn(),
    deletePersonalSkill: vi.fn(),
    recommendations: vi.fn(),
  },
}));

class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

function renderPanel(
  props: Partial<React.ComponentProps<typeof SkillPanel>> = {},
) {
  const onClose = vi.fn();
  const onUseSkill = vi.fn();
  const utils = render(
    <SkillPanel isOpen onClose={onClose} onUseSkill={onUseSkill} {...props} />,
  );
  return { onClose, onUseSkill, ...utils };
}

describe("SkillPanel 总结当前对话入口（IK60X1）", () => {
  afterEach(cleanup);

  it("宿主传入回调时创建页签渲染入口，点击触发回调（面板本身不自动发送）", () => {
    const onSummarizeConversation = vi.fn();
    renderPanel({ onSummarizeConversation });

    fireEvent.click(screen.getByTestId("skill-tab-create"));
    const entry = screen.getByTestId("skill-summarize-entry");
    expect(entry).toHaveTextContent("总结当前对话");
    expect(entry).toBeEnabled();

    fireEvent.click(entry);
    expect(onSummarizeConversation).toHaveBeenCalledTimes(1);
  });

  it("未传回调（首页/generate 宿主）不渲染入口", () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("skill-tab-create"));
    expect(screen.queryByTestId("skill-summarize-entry")).toBeNull();
  });

  it("脏草稿时点击入口先确认放弃：取消不触发回调，确认才触发", () => {
    const onSummarizeConversation = vi.fn();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPanel({ onSummarizeConversation });

    fireEvent.click(screen.getByTestId("skill-tab-create"));
    fireEvent.change(screen.getByTestId("skill-md-editor"), {
      target: { value: "---\nname: 草稿\ndescription: 简介\n---\n\n正文\n" },
    });

    fireEvent.click(screen.getByTestId("skill-summarize-entry"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSummarizeConversation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("skill-summarize-entry"));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(onSummarizeConversation).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});
