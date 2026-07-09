// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RouteError from "./error";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("RouteError", () => {
  const makeError = (message: string, digest?: string) => {
    const err = new Error(message);
    if (digest) (err as Error & { digest?: string }).digest = digest;
    return err as Error & { digest?: string };
  };

  it("渲染中文标题与提示", () => {
    render(
      <RouteError error={makeError("boom")} reset={vi.fn()} />
    );
    expect(screen.getByText("出了点问题")).toBeInTheDocument();
    expect(screen.getByText(/可以重试/)).toBeInTheDocument();
  });

  it("提供重试按钮与返回首页链接", () => {
    render(<RouteError error={makeError("boom")} reset={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "重试" })
    ).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "返回首页" });
    expect(home.getAttribute("href")).toBe("/");
  });

  it("点击重试 → 调用 reset", () => {
    const reset = vi.fn();
    render(<RouteError error={makeError("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("dev 模式（NODE_ENV !== production）展示错误堆栈", () => {
    // vitest 默认 NODE_ENV=test，test !== production → dev 分支
    render(
      <RouteError error={makeError("网络异常")} reset={vi.fn()} />
    );
    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "网络异常"
    );
  });

  it("消息为空时 dev 模式也不渲染堆栈容器", () => {
    const empty = makeError("   "); // trim 后为空
    render(<RouteError error={empty} reset={vi.fn()} />);
    expect(screen.queryByTestId("error-message")).toBeNull();
  });
});