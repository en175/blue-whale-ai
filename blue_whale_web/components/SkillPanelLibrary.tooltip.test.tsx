// @vitest-environment jsdom
/** SkillPanel 技能库卡片简介悬停提示（IK6H3Q，US19）：
 *  data-tooltip 必须挂在未裁剪的包裹元素上——挂在带 line-clamp（overflow:hidden）
 *  的简介元素自身会让定位到元素上方的 ::before 提示被裁剪，永不显示。 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkillPanel from "./SkillPanel";

const { LONG_DESC } = vi.hoisted(() => ({
  LONG_DESC:
    "这是一段足够长的公开简介，用来在两列或三列断点下触发两行截断，从而需要悬停提示查看完整内容。",
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

describe("SkillPanel 技能库简介悬停提示（IK6H3Q）", () => {
  afterEach(cleanup);

  it("data-tooltip 挂在未裁剪包裹元素上，且内容为完整公开简介", async () => {
    render(<SkillPanel isOpen onClose={vi.fn()} onUseSkill={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByTestId("skill-library-card")).toBeInTheDocument(),
    );

    const card = screen.getByTestId("skill-library-card");
    const tipCarrier = card.querySelector("[data-tooltip]");
    expect(tipCarrier).not.toBeNull();
    // 回归核心：携带提示的元素不得带 line-clamp（overflow:hidden 会裁剪 ::before）
    expect(tipCarrier!.className).not.toContain("line-clamp");
    expect(tipCarrier!.getAttribute("data-tooltip")).toBe(LONG_DESC);
    // 截断展示仍在内层简介元素上
    const desc = tipCarrier!.querySelector(".line-clamp-2");
    expect(desc).not.toBeNull();
    expect(desc).toHaveTextContent(LONG_DESC);
  });
});
