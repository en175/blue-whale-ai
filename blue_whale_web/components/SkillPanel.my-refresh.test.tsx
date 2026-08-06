// @vitest-environment jsdom
/** SkillPanel 添加官方技能后「我的技能」列表失效（IK6H3L）：
 *  先访问「我的技能」（挂载并拉取空列表）→ 技能库添加成功 → 切回「我的技能」
 *  必须重拉并展示新增引用；修复前列表停留在旧数据（空态）。 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const LIBRARY_ITEM = {
  creative_skill_id: "cs_refresh_test",
  name: "Refresh Test Skill",
  description: "用于验证添加后我的技能列表刷新。",
  cover_url: null,
  source: "official",
  asset_domain: "official" as const,
  added: false,
  category: "other",
  usage_count: 0,
};

const MINE_ITEM = {
  creative_skill_id: "cs_refresh_test",
  auto: false,
  name: "Refresh Test Skill",
  description: "用于验证添加后我的技能列表刷新。",
  cover_url: null,
  source: "official",
  asset_domain: "official" as const,
};

describe("SkillPanel 添加后我的技能列表刷新（IK6H3L）", () => {
  afterEach(cleanup);

  it("添加成功后切回我的技能重拉并展示新增引用", async () => {
    const mineMock = vi.mocked(skillsApi.mine);
    mineMock.mockResolvedValue({ records: [], total: 0, current: 1, size: 50 });
    vi.mocked(skillsApi.library).mockResolvedValue({
      records: [LIBRARY_ITEM],
      total: 1,
      current: 1,
      size: 50,
    });
    vi.mocked(skillsApi.add).mockResolvedValue(undefined);

    render(<SkillPanel isOpen onClose={vi.fn()} onUseSkill={vi.fn()} />);

    // 先访问我的技能（挂载 + 首次拉取，空列表）
    fireEvent.click(screen.getByTestId("skill-tab-my"));
    await waitFor(() => expect(mineMock).toHaveBeenCalledTimes(1));

    // 技能库添加成功
    fireEvent.click(screen.getByTestId("skill-tab-library"));
    await waitFor(() =>
      expect(screen.getByTestId("skill-library-card")).toBeInTheDocument(),
    );
    mineMock.mockResolvedValue({
      records: [MINE_ITEM],
      total: 1,
      current: 1,
      size: 50,
    });
    fireEvent.click(screen.getByTestId("skill-library-add-btn"));
    await waitFor(() =>
      expect(screen.getByText("技能已添加")).toBeInTheDocument(),
    );

    // 切回我的技能：必须重拉并出现新增引用
    fireEvent.click(screen.getByTestId("skill-tab-my"));
    await waitFor(() => expect(mineMock.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() =>
      expect(screen.getByTestId("skill-my-row")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("skill-my-row")).toHaveTextContent(
      "Refresh Test Skill",
    );
  });
});
