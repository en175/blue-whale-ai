// @vitest-environment jsdom
/** SkillPanel 创建技能工具栏窄断点防挤压（IK6H3O，US8）：
 *  工具栏允许整组换行（flex-wrap），按钮文字一律 whitespace-nowrap，
 *  防止 500px 断点下「编写」竖排、「保存到我的技能」折行。 */
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

describe("SkillPanel 创建技能工具栏窄断点（IK6H3O）", () => {
  afterEach(cleanup);

  it("工具栏可整组换行，按钮文字不换行", () => {
    render(
      <SkillPanel
        isOpen
        onClose={vi.fn()}
        onUseSkill={vi.fn()}
        onSummarizeConversation={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("skill-tab-create"));

    const modeBtn = screen.getByTestId("skill-create-mode-write");
    const toolbar = modeBtn.closest("div.flex")!.parentElement!;
    expect(toolbar.className).toContain("flex-wrap");

    for (const testId of [
      "skill-create-mode-write",
      "skill-create-mode-upload",
      "skill-summarize-entry",
      "skill-ai-format-btn",
      "skill-save-btn",
    ]) {
      expect(screen.getByTestId(testId).className).toContain(
        "whitespace-nowrap",
      );
    }
  });
});
