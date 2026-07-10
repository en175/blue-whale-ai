// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import NotFound from "./not-found";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("NotFound", () => {
  it("渲染 404 标识与标题", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("页面不存在")).toBeInTheDocument();
  });

  it("提供返回首页入口", () => {
    render(<NotFound />);
    const link = screen.getByRole("link", { name: "返回首页" });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/");
  });

  it("包含中文友好提示", () => {
    render(<NotFound />);
    expect(screen.getByText(/回到首页继续创作/)).toBeInTheDocument();
  });
});