// @vitest-environment jsdom
/** SkillPanel 遮罩层级回归：技能面板是模态工作区，其遮罩 z-index 必须高于
 *  AgentChatPanel 悬浮层（z-[2147483600]），否则 agent 对话框会视觉遮盖在
 *  技能页面之上、且因背景 inert 完全无法点击（只见其形、不可交互）。
 *  修复前遮罩为 z-[200]，远低于悬浮层。 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillsApi } from "@/components/api/skills";
import SkillPanel from "./SkillPanel";

vi.mock("@/components/api/skills", () => ({
  skillsApi: {
    library: vi.fn(),
    mine: vi.fn(),
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

/** AgentChatPanel 悬浮层层级（AgentChatPanel.tsx 的 z-[2147483600]） */
const AGENT_PANEL_LAYER = 2147483600;

describe("SkillPanel 遮罩层级", () => {
  afterEach(cleanup);

  it("遮罩 z-index 高于 AgentChatPanel 悬浮层", () => {
    vi.mocked(skillsApi.library).mockResolvedValue({
      records: [],
      total: 0,
      current: 1,
      size: 50,
    });

    render(<SkillPanel isOpen onClose={vi.fn()} onUseSkill={vi.fn()} />);

    const backdrop = screen.getByTestId("skill-panel").parentElement;
    expect(backdrop).not.toBeNull();
    const match = backdrop!.className.match(/z-\[(\d+)\]/);
    expect(match, "遮罩必须声明 z-index").not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(AGENT_PANEL_LAYER);
  });
});
