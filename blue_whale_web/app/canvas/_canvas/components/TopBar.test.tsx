// @vitest-environment jsdom
/**
 * TopBar logo 按钮测试：
 * 点击左上角 Blue-Whale logo 按钮（"导航菜单"）应跳转回首页 "/"，
 * 修复历史缺陷——该按钮曾是纯占位、无任何点击响应。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopBar } from "./TopBar";
import type { Project } from "../types";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const project: Project = {
  id: "7",
  name: "我的项目",
  thumb: null,
  canvas: { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
  messages: [],
};

function renderTopBar() {
  return render(
    <TopBar
      activeProject={project}
      projects={[project]}
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe("TopBar logo 按钮", () => {
  it("点击 logo 按钮应跳转首页", () => {
    renderTopBar();

    fireEvent.click(screen.getByRole("button", { name: "导航菜单" }));

    expect(pushMock).toHaveBeenCalledWith("/");
  });
});
