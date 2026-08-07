// @vitest-environment jsdom
/** SkillPanel 技能库卡片简介悬停浮层（横版卡片改版定稿，替代 IK6H3Q data-tooltip）：
 *  简介全文渲染在卡片内向下展开的大浮层中——默认 opacity-0 不可见、悬停卡片
 *  （group-hover）时显示；浮层 aria-hidden + pointer-events-none 不参与交互；
 *  卡片内可见简介仍为 3 行截断。 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillPanel from "./SkillPanel";

const { LONG_DESC } = vi.hoisted(() => ({
  LONG_DESC:
    "这是一段足够长的公开简介，用来在两列或三列断点下触发三行截断，从而需要悬停浮层查看完整内容。",
}));

vi.mock("@/components/api/skills", () => ({
  skillsApi: {
    library: vi.fn().mockResolvedValue({
      records: [
        {
          creative_skill_id: "cs_test_tooltip",
          name: "Tooltip Test Skill",
          description: LONG_DESC,
          cover_url: null,
          source: "official",
          asset_domain: "official",
          added: false,
          category: "other",
          usage_count: 0,
        },
      ],
      total: 1,
      current: 1,
      size: 50,
    }),
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

describe("SkillPanel 技能库简介悬停浮层（横版卡片改版）", () => {
  afterEach(cleanup);

  it("卡片内含简介全文浮层：默认隐藏、悬停展开，可见简介为 3 行截断", async () => {
    render(<SkillPanel isOpen onClose={vi.fn()} onUseSkill={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId("skill-library-card")).toBeInTheDocument(),
    );

    const card = screen.getByTestId("skill-library-card");

    // 悬停浮层：完整简介、aria-hidden、默认透明、group-hover 展开
    const overlay = card.querySelector(".tc-agent-skill-card__desc-overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.getAttribute("aria-hidden")).toBe("true");
    expect(overlay!).toHaveTextContent(LONG_DESC);
    expect(overlay!.className).toContain("opacity-0");
    expect(overlay!.className).toContain("group-hover:opacity-100");
    expect(overlay!.className).toContain("pointer-events-none");

    // 旧的 data-tooltip 方案已移除
    expect(card.querySelector("[data-tooltip]")).toBeNull();

    // 卡片内可见简介仍为截断展示（3 行）
    const desc = card.querySelector(".tc-agent-skill-row__desc");
    expect(desc).not.toBeNull();
    expect(desc!.className).toContain("line-clamp-3");
    expect(desc!).toHaveTextContent(LONG_DESC);
  });
});
