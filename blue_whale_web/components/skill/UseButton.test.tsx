// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import UseButton from "./UseButton";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("UseButton", () => {
  it("渲染「直接使用」文本 + 点击触发 onClick", () => {
    const onClick = vi.fn();
    render(<UseButton onClick={onClick} />);

    const btn = screen.getByRole("button", { name: /直接使用/ });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
