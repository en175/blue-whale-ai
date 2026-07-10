// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LibraryContent from "./LibraryContent";
import { LIBRARY_SKILLS } from "./data";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("LibraryContent", () => {
  it("渲染搜索框 + 排序按钮 + 全部 LIBRARY_SKILLS 卡片", () => {
    render(
      <LibraryContent
        skills={LIBRARY_SKILLS}
        addedIds={new Set()}
        search=""
        setSearch={vi.fn()}
        onUse={vi.fn()}
        onToggleAdded={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("搜索 Skills")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "排序 Skills" }),
    ).toBeInTheDocument();
    for (const skill of LIBRARY_SKILLS) {
      expect(screen.getByText(skill.title)).toBeInTheDocument();
    }
  });

  it("输入搜索词触发 setSearch + 点卡片 Use 触发 onUse(skill.title)", () => {
    const setSearch = vi.fn();
    const onUse = vi.fn();
    render(
      <LibraryContent
        skills={LIBRARY_SKILLS}
        addedIds={new Set()}
        search=""
        setSearch={setSearch}
        onUse={onUse}
        onToggleAdded={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("搜索 Skills"), {
      target: { value: "TVC" },
    });
    expect(setSearch).toHaveBeenCalledWith("TVC");

    const firstTitle = LIBRARY_SKILLS[0].title;
    fireEvent.click(screen.getAllByRole("button", { name: /直接使用/ })[0]);
    expect(onUse).toHaveBeenCalledWith(firstTitle);
  });
});
