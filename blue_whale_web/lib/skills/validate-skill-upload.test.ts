import { describe, expect, it } from "vitest";

import { validateSkillUpload } from "./validate-skill-upload.js";

// SKILL.md 上传校验（IK60WW）：非 .md / 非法 frontmatter / 空 name / 空 description /
// 空正文分别给出具体错误；合法文件返回解析出的 name/description 供 UI 展示。
// 字段非空语义与服务端 handleCreateSkill（handle-skill-writes.ts）一致，
// 名称冲突/保留名由服务端在保存时返回。

const VALID_MD = "---\nname: 我的技能\ndescription: 简介\n---\n正文内容";

describe("validateSkillUpload", () => {
  it("合法 .md → ok，返回 name/description", () => {
    expect(
      validateSkillUpload({ fileName: "SKILL.md", content: VALID_MD }),
    ).toEqual({
      ok: true,
      name: "我的技能",
      description: "简介",
    });
  });

  it("大写扩展名 .MD → 接受", () => {
    expect(
      validateSkillUpload({ fileName: "MY_SKILL.MD", content: VALID_MD }).ok,
    ).toBe(true);
  });

  it("非 .md 扩展名 → 具体错误", () => {
    expect(
      validateSkillUpload({ fileName: "skill.txt", content: VALID_MD }),
    ).toEqual({
      ok: false,
      error: "仅支持 .md 文件",
    });
    expect(
      validateSkillUpload({ fileName: "skill", content: VALID_MD }),
    ).toEqual({ ok: false, error: "仅支持 .md 文件" });
  });

  it("无 frontmatter → 具体错误", () => {
    expect(
      validateSkillUpload({
        fileName: "a.md",
        content: "纯正文，无 frontmatter",
      }),
    ).toEqual({ ok: false, error: "YAML frontmatter 格式不合法" });
  });

  it("frontmatter 缺闭合 → 具体错误", () => {
    expect(
      validateSkillUpload({ fileName: "a.md", content: "---\nname: Test\n" }),
    ).toEqual({ ok: false, error: "YAML frontmatter 格式不合法" });
  });

  it("name 为空 → 具体错误", () => {
    expect(
      validateSkillUpload({
        fileName: "a.md",
        content: "---\nname: \ndescription: Desc\n---\nbody",
      }),
    ).toEqual({ ok: false, error: "名称不能为空" });
  });

  it("description 为空 → 具体错误", () => {
    expect(
      validateSkillUpload({
        fileName: "a.md",
        content: "---\nname: Test\ndescription: \n---\nbody",
      }),
    ).toEqual({ ok: false, error: "简介不能为空" });
  });

  it("正文为空 → 具体错误", () => {
    expect(
      validateSkillUpload({
        fileName: "a.md",
        content: "---\nname: Test\ndescription: Desc\n---\n",
      }),
    ).toEqual({ ok: false, error: "正文不能为空" });
  });
});
