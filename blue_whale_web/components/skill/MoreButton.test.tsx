// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, render, screen } from "@testing-library/react";
import MoreButton from "./MoreButton";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("MoreButton", () => {
  it("用 aria-label 渲染可访问按钮（带传入 label）", () => {
    render(<MoreButton label="My Skill 的更多选项" />);
    const btn = screen.getByRole("button", { name: "My Skill 的更多选项" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});
