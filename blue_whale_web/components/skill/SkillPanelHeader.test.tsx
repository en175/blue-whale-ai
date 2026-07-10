// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SkillPanelHeader from "./SkillPanelHeader";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("SkillPanelHeader", () => {
  it("渲染 3 个 tab + 关闭按钮 + 当前 activeTab 标 aria-selected=true", () => {
    render(
      <SkillPanelHeader
        activeTab="library"
        onChangeTab={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "我的 Skills" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "Skill 库" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "创建 Skill" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "关闭 Skills" }),
    ).toBeInTheDocument();
  });

  it("点 tab 触发 onChangeTab(对应 tab 名) + 点关闭触发 onClose", () => {
    const onChangeTab = vi.fn();
    const onClose = vi.fn();
    render(
      <SkillPanelHeader
        activeTab="my"
        onChangeTab={onChangeTab}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "创建 Skill" }));
    expect(onChangeTab).toHaveBeenCalledWith("create");

    fireEvent.click(screen.getByRole("button", { name: "关闭 Skills" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
