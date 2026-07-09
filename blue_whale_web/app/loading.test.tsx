// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import Loading from "./loading";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("Loading", () => {
  it("暴露可访问的状态语义", () => {
    render(<Loading />);
    // role=status + aria-label 共同构成可达性兜底
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "页面加载中"
    );
  });

  it("渲染首页 hero 三层骨架：标题条 + 输入框 + 模板卡组", () => {
    const { container } = render(<Loading />);
    // animate-pulse class 标记所有占位块
    const placeholders = container.querySelectorAll(".animate-pulse");
    // 至少：胶囊 + 标题 + 输入框 + 标签条 + 三张模板卡 = 7
    expect(placeholders.length).toBeGreaterThanOrEqual(7);
  });
});