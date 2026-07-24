// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillRecommendationSection } from "./SkillRecommendationSection";
import type { CreativeSkillRecommendation } from "@/components/api/skills";

const recommendations: CreativeSkillRecommendation[] = [
  {
    creative_skill_id: "cs_a",
    name: "海报大师",
    description: "生成营销海报",
    activation_eligibility: "requires_user_use",
  },
  {
    creative_skill_id: "cs_b",
    name: "文案专家",
    description: "打磨推广文案",
    activation_eligibility: "requires_user_use",
  },
];

describe("SkillRecommendationSection", () => {
  afterEach(cleanup);

  it("渲染推荐项 name/description 与 Use 按钮", () => {
    render(
      <SkillRecommendationSection
        recommendations={recommendations}
        loading={false}
        onUse={() => {}}
      />,
    );

    expect(screen.getByText("推荐技能")).toBeTruthy();
    expect(screen.getByText("海报大师")).toBeTruthy();
    expect(screen.getByText("生成营销海报")).toBeTruthy();
    expect(screen.getByText("文案专家")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "使用" })).toHaveLength(2);
  });

  it("点 Use 上抛稳定 creative_skill_id 与 name", () => {
    const onUse = vi.fn();
    render(
      <SkillRecommendationSection
        recommendations={recommendations}
        loading={false}
        onUse={onUse}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "使用" })[1]);

    expect(onUse).toHaveBeenCalledWith({
      creative_skill_id: "cs_b",
      name: "文案专家",
    });
  });

  it("加载完成且为空时渲染简短空态", () => {
    render(
      <SkillRecommendationSection
        recommendations={[]}
        loading={false}
        onUse={() => {}}
      />,
    );

    expect(screen.getByText("暂无推荐技能")).toBeTruthy();
  });

  it("加载中展示加载态", () => {
    render(
      <SkillRecommendationSection
        recommendations={[]}
        loading
        onUse={() => {}}
      />,
    );

    expect(screen.getByText("加载中…")).toBeTruthy();
  });
});
