// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibrarySkillCard from "./LibrarySkillCard";
import type { LibrarySkill } from "./data";

expect.extend(jestDomMatchers);

const sampleSkill: LibrarySkill = {
  id: "lib-test",
  title: "Lib Skill",
  description: "Library test description.",
  cover: "https://placehold.co/200x200",
  usage: "1.2k",
  contributor: "@Tester",
  added: false,
};

afterEach(cleanup);

describe("LibrarySkillCard", () => {
  it("added=false 时显示「添加」按钮 + 显示 usage / contributor", () => {
    render(
      <LibrarySkillCard
        skill={sampleSkill}
        added={false}
        onUse={vi.fn()}
        onToggleAdded={vi.fn()}
      />,
    );
    expect(screen.getByText("Lib Skill")).toBeInTheDocument();
    expect(screen.getByText("1.2k")).toBeInTheDocument();
    expect(screen.getByText("@Tester")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "添加" }),
    ).toBeInTheDocument();
  });

  it("added=true 时「添加」按钮变「已添加」且禁用", () => {
    render(
      <LibrarySkillCard
        skill={sampleSkill}
        added={true}
        onUse={vi.fn()}
        onToggleAdded={vi.fn()}
      />,
    );
    const addBtn = screen.getByRole("button", { name: "已添加" });
    expect(addBtn).toBeDisabled();
  });

  it("点添加按钮触发 onToggleAdded（added=false 时）", () => {
    const onToggleAdded = vi.fn();
    render(
      <LibrarySkillCard
        skill={sampleSkill}
        added={false}
        onUse={vi.fn()}
        onToggleAdded={onToggleAdded}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onToggleAdded).toHaveBeenCalledTimes(1);
  });
});
