// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CreateSkillContent from "./CreateSkillContent";
import { SKILL_MD_TEMPLATE } from "./data";

expect.extend(jestDomMatchers);

afterEach(cleanup);

describe("CreateSkillContent", () => {
  it("mode=write 默认渲染 SKILL.md textarea + 保存按钮初始禁用（空 md）", () => {
    render(
      <CreateSkillContent
        mode="write"
        setMode={vi.fn()}
        skillMd=""
        setSkillMd={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: "编写 SKILL.md" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const saveBtn = screen.getByRole("button", { name: /保存到我的 Skills/ });
    expect(saveBtn).toBeDisabled();
  });

  it("skillMd 非空 → 保存按钮启用 + textarea 改动触发 setSkillMd", () => {
    const setSkillMd = vi.fn();
    render(
      <CreateSkillContent
        mode="write"
        setMode={vi.fn()}
        skillMd={SKILL_MD_TEMPLATE}
        setSkillMd={setSkillMd}
      />,
    );
    const saveBtn = screen.getByRole("button", { name: /保存到我的 Skills/ });
    expect(saveBtn).toBeEnabled();

    const ta = screen.getByPlaceholderText(/在此编写/);
    fireEvent.change(ta, { target: { value: "## new content" } });
    expect(setSkillMd).toHaveBeenCalledWith("## new content");
  });

  it("点「上传 SKILL.md」tab 触发 setMode('upload')", () => {
    const setMode = vi.fn();
    render(
      <CreateSkillContent
        mode="write"
        setMode={setMode}
        skillMd=""
        setSkillMd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "上传 SKILL.md" }));
    expect(setMode).toHaveBeenCalledWith("upload");
  });
});
