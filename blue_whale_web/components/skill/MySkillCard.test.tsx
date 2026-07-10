// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MySkillCard from "./MySkillCard";
import type { MySkill } from "./data";

expect.extend(jestDomMatchers);

const sampleSkill: MySkill = {
  id: "test-skill",
  title: "Test Skill",
  description: "A test skill for unit testing.",
  cover: "https://example.com/cover.png",
};

afterEach(cleanup);

describe("MySkillCard", () => {
  it("渲染标题 + auto=true 时 switch aria-checked=true", () => {
    render(
      <MySkillCard
        skill={sampleSkill}
        auto={true}
        onToggleAuto={vi.fn()}
        onUse={vi.fn()}
      />,
    );
    expect(screen.getByText("Test Skill")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: /关闭自动应用/ });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("点 switch 触发 onToggleAuto + 点 Use 触发 onUse", () => {
    const onToggleAuto = vi.fn();
    const onUse = vi.fn();
    render(
      <MySkillCard
        skill={sampleSkill}
        auto={false}
        onToggleAuto={onToggleAuto}
        onUse={onUse}
      />,
    );

    fireEvent.click(screen.getByRole("switch"));
    expect(onToggleAuto).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /直接使用/ }));
    expect(onUse).toHaveBeenCalledTimes(1);
  });
});
