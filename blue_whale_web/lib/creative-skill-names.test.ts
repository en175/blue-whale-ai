// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rememberCreativeSkillName,
  clearCreativeSkillNames,
  usePrefetchCreativeSkillNames,
} from "./creative-skill-names";
import { skillsApi } from "@/components/api/skills";

vi.mock("@/components/api/skills", () => ({
  skillsApi: { mine: vi.fn() },
}));

describe("creative_skill_id → name 映射", () => {
  beforeEach(() => {
    clearCreativeSkillNames();
    vi.clearAllMocks();
  });

  it("backendReady 首真时预拉 mine page1 灌入映射", async () => {
    vi.mocked(skillsApi.mine).mockResolvedValue({
      records: [
        { creative_skill_id: "cs_x", name: "技能 X" },
        { creative_skill_id: null, name: "无名" },
      ],
    } as never);

    const { rerender } = renderHook(
      ({ ready }: { ready: boolean }) => usePrefetchCreativeSkillNames(ready),
      { initialProps: { ready: false } },
    );
    expect(skillsApi.mine).not.toHaveBeenCalled();

    rerender({ ready: true });
    await waitFor(() => expect(skillsApi.mine).toHaveBeenCalled());
  });

  it("预拉失败静默，不影响既有映射", async () => {
    rememberCreativeSkillName("cs_a", "技能 A");
    vi.mocked(skillsApi.mine).mockRejectedValue(new Error("网络错误"));

    renderHook(() => usePrefetchCreativeSkillNames(true));
    await waitFor(() => expect(skillsApi.mine).toHaveBeenCalled());
  });
});
