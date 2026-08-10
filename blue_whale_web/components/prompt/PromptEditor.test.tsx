// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import PromptEditor from "./PromptEditor";

expect.extend(jestDomMatchers);

afterEach(() => {
  cleanup();
});

describe("PromptEditor 固定高度滑动展示（IK7JJP）", () => {
  it("输入区固定最大高度并纵向滚动，不引入横向滚动", () => {
    render(<PromptEditor value="" onChange={vi.fn()} placeholder="占位符" />);

    const editor = screen.getByRole("textbox");
    expect(editor).toHaveClass("max-h-[120px]");
    expect(editor).toHaveClass("overflow-y-auto");
    expect(editor.className).not.toMatch(/overflow-x-(auto|scroll)/);
  });
});
