// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { skillsApi } from "@/components/api/skills";
import type { CreativeSkillRecommendation } from "@/components/api/skills";
import { useCreativeSkillRecommendations } from "./useCreativeSkillRecommendations";

vi.mock("@/components/api/skills", () => ({
  skillsApi: { recommendations: vi.fn() },
}));

const recommendation: CreativeSkillRecommendation = {
  creative_skill_id: "cs_a",
  name: "海报大师",
  description: "生成营销海报",
  activation_eligibility: "requires_user_use",
};

describe("useCreativeSkillRecommendations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runId 有效时拉取并返回推荐列表", async () => {
    vi.mocked(skillsApi.recommendations).mockResolvedValue([recommendation]);

    const { result } = renderHook(() => useCreativeSkillRecommendations(8));

    await waitFor(() =>
      expect(result.current.recommendations).toEqual([recommendation]),
    );
    expect(skillsApi.recommendations).toHaveBeenCalledWith(8);
    expect(result.current.loading).toBe(false);
  });

  it("runId 为 null 时不发请求且返回空列表", () => {
    const { result } = renderHook(() => useCreativeSkillRecommendations(null));

    expect(skillsApi.recommendations).not.toHaveBeenCalled();
    expect(result.current.recommendations).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("runId 切换时按新 id 重拉", async () => {
    vi.mocked(skillsApi.recommendations).mockResolvedValue([recommendation]);

    const { result, rerender } = renderHook(
      ({ runId }) => useCreativeSkillRecommendations(runId),
      { initialProps: { runId: 8 as number | null } },
    );
    await waitFor(() =>
      expect(result.current.recommendations).toEqual([recommendation]),
    );

    vi.mocked(skillsApi.recommendations).mockResolvedValue([]);
    rerender({ runId: 9 });

    await waitFor(() => expect(result.current.recommendations).toEqual([]));
    expect(skillsApi.recommendations).toHaveBeenLastCalledWith(9);
  });

  it("拉取失败静默回退空列表", async () => {
    vi.mocked(skillsApi.recommendations).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCreativeSkillRecommendations(8));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.recommendations).toEqual([]);
  });
});
