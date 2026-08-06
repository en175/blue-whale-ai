import { describe, expect, it } from "vitest";
import { parseSkillMd, serializeSkillMd } from "./skill-md";

describe("serializeSkillMd（IK60WZ 只读查看/复制，契约 §13.1）", () => {
  it("重建完整 SKILL.md：frontmatter + 正文", () => {
    expect(
      serializeSkillMd({
        name: "我的技能",
        description: "个人资产",
        body: "正文内容",
      }),
    ).toBe("---\nname: 我的技能\ndescription: 个人资产\n---\n\n正文内容\n");
  });

  it("与 parseSkillMd 对称：serialize → parse 还原三元组", () => {
    const input = {
      name: "周报生成",
      description: "根据要点生成周报",
      body: "# 步骤\n\n1. 收集要点\n2. 输出周报",
    };
    expect(parseSkillMd(serializeSkillMd(input))).toEqual(input);
  });
});
