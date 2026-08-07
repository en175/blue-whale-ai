import { describe, expect, it, vi } from "vitest";

import { handleFormatSkillDraft } from "./handle-skill-writes.js";

// AI 格式化（IK60X0）：后台固定规则 + 受控 AI 接口返回完整替换文本；
// 不触碰持久化。AI 失败或返回非合法 SKILL.md → 100104，前端保留原草稿。

const DRAFT = "---\nname: 旧名\ndescription: 旧简介\n---\n\n正文\n";
const FORMATTED = "---\nname: 新名\ndescription: 新简介\n---\n\n整理后的正文\n";

function makeDeps(complete: ReturnType<typeof vi.fn>) {
  return { ai: { complete }, rules: "固定格式化规则" };
}

describe("handleFormatSkillDraft", () => {
  it("成功 → 200 完整替换文本；固定规则与草稿原样传给 AI（可控替身证明规则输入）", async () => {
    const complete = vi.fn().mockResolvedValue(FORMATTED);
    const result = await handleFormatSkillDraft(DRAFT, makeDeps(complete));
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { content: FORMATTED },
    });
    expect(complete).toHaveBeenCalledWith({
      rules: "固定格式化规则",
      draft: DRAFT,
    });
  });

  it("空白草稿 → 400，不调 AI", async () => {
    const complete = vi.fn();
    const result = await handleFormatSkillDraft("   \n ", makeDeps(complete));
    expect(result).toEqual({
      code: 400,
      msg: "草稿内容为空，无法格式化",
      data: null,
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("AI 接口抛错 → 100104「格式化失败」，无部分内容", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("upstream 500"));
    const result = await handleFormatSkillDraft(DRAFT, makeDeps(complete));
    expect(result).toEqual({
      code: 100104,
      msg: "AI 格式化失败，请稍后重试",
      data: null,
    });
  });

  it.each([
    ["空字符串", ""],
    ["纯空白", "  \n "],
    ["缺 frontmatter", "只是普通 Markdown 正文"],
    ["name 为空", "---\nname: \ndescription: 简介\n---\n\n正文\n"],
    ["description 为空", "---\nname: 名称\ndescription: \n---\n\n正文\n"],
    ["正文为空", "---\nname: 名称\ndescription: 简介\n---\n\n"],
  ])("AI 返回无效内容（%s）→ 100104「保留原草稿」", async (_label, bad) => {
    const complete = vi.fn().mockResolvedValue(bad);
    const result = await handleFormatSkillDraft(DRAFT, makeDeps(complete));
    expect(result).toEqual({
      code: 100104,
      msg: "AI 返回内容无效，已保留原草稿",
      data: null,
    });
  });
});
