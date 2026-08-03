import { describe, expect, it, vi } from "vitest";

import {
  handleAddSkill,
  handleCreateSkill,
  handleRemoveSkill,
  handleUpdateSkillAuto,
  parseSkillMd,
} from "./handle-skill-writes.js";
import {
  SkillNameConflictError,
  SkillNameReservedError,
} from "@blue-whale/persistence";

// skills 写操作：add（加入我的）/ remove（移除）/ updateAuto（切开关）。
// 契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§6/§7：
// 入参一律 creative_skill_id（^[a-z][a-z0-9_]{2,79}$），格式非法/未知/个人域 → 100100。

function makeRepo() {
  return {
    resolveOfficialSkillId: vi.fn(),
    addReference: vi.fn(),
    removeReferenceByCreativeSkillId: vi.fn(),
    updateAutoByCreativeSkillId: vi.fn(),
    createPersonalSkill: vi.fn(),
  };
}

describe("handleAddSkill", () => {
  it("resolve 命中 → addReference（内部 id）→ 200", async () => {
    const repo = makeRepo();
    repo.resolveOfficialSkillId.mockResolvedValue("3");
    const result = await handleAddSkill("9", "poster_gen", { skills: repo });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.resolveOfficialSkillId).toHaveBeenCalledWith("poster_gen");
    expect(repo.addReference).toHaveBeenCalledWith("9", "3");
  });

  it("resolve 未命中（未知/个人域）→ 100100，不加引用", async () => {
    const repo = makeRepo();
    repo.resolveOfficialSkillId.mockResolvedValue(null);
    const result = await handleAddSkill("9", "unknown_skill", { skills: repo });
    expect(result).toEqual({
      code: 100100,
      msg: "Skill 不存在: unknown_skill",
      data: null,
    });
    expect(repo.addReference).not.toHaveBeenCalled();
  });

  it.each(["BAD-ID!!", "Poster_gen", "ab", "1poster"])(
    "creative_skill_id 格式非法（%s）→ 100100，不触碰 repo",
    async (badId) => {
      const repo = makeRepo();
      const result = await handleAddSkill("9", badId, { skills: repo });
      expect(result).toEqual({
        code: 100100,
        msg: `Skill 不存在: ${badId}`,
        data: null,
      });
      expect(repo.resolveOfficialSkillId).not.toHaveBeenCalled();
      expect(repo.addReference).not.toHaveBeenCalled();
    },
  );
});

describe("handleRemoveSkill", () => {
  it("resolve 命中 → 删引用 → 200", async () => {
    const repo = makeRepo();
    repo.resolveOfficialSkillId.mockResolvedValue("3");
    repo.removeReferenceByCreativeSkillId.mockResolvedValue(true);
    const result = await handleRemoveSkill("9", "poster_gen", { skills: repo });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.resolveOfficialSkillId).toHaveBeenCalledWith("poster_gen");
    expect(repo.removeReferenceByCreativeSkillId).toHaveBeenCalledWith(
      "9",
      "poster_gen",
    );
  });

  it("官方域但未添加 → 仍 200（逻辑删幂等）", async () => {
    const repo = makeRepo();
    repo.resolveOfficialSkillId.mockResolvedValue("3");
    repo.removeReferenceByCreativeSkillId.mockResolvedValue(false);
    const result = await handleRemoveSkill("9", "poster_gen", { skills: repo });
    expect(result.code).toBe(200);
  });

  it("resolve 未命中（未知/个人域）→ 100100，不删引用", async () => {
    const repo = makeRepo();
    repo.resolveOfficialSkillId.mockResolvedValue(null);
    const result = await handleRemoveSkill("9", "unknown_skill", {
      skills: repo,
    });
    expect(result).toEqual({
      code: 100100,
      msg: "Skill 不存在: unknown_skill",
      data: null,
    });
    expect(repo.removeReferenceByCreativeSkillId).not.toHaveBeenCalled();
  });

  it("creative_skill_id 格式非法 → 100100，不触碰 repo", async () => {
    const repo = makeRepo();
    const result = await handleRemoveSkill("9", "BAD-ID!!", { skills: repo });
    expect(result).toEqual({
      code: 100100,
      msg: "Skill 不存在: BAD-ID!!",
      data: null,
    });
    expect(repo.resolveOfficialSkillId).not.toHaveBeenCalled();
    expect(repo.removeReferenceByCreativeSkillId).not.toHaveBeenCalled();
  });
});

describe("handleUpdateSkillAuto", () => {
  it("命中 → 200", async () => {
    const repo = makeRepo();
    repo.updateAutoByCreativeSkillId.mockResolvedValue(true);
    const result = await handleUpdateSkillAuto("9", "poster_gen", true, {
      skills: repo,
    });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.updateAutoByCreativeSkillId).toHaveBeenCalledWith(
      "9",
      "poster_gen",
      true,
    );
  });

  it("未添加 → 100100", async () => {
    const repo = makeRepo();
    repo.updateAutoByCreativeSkillId.mockResolvedValue(false);
    const result = await handleUpdateSkillAuto("9", "poster_gen", false, {
      skills: repo,
    });
    expect(result).toEqual({
      code: 100100,
      msg: "未添加该 Skill，无法设置 auto",
      data: null,
    });
  });

  it("creative_skill_id 格式非法 → 100100，不触碰 repo", async () => {
    const repo = makeRepo();
    const result = await handleUpdateSkillAuto("9", "Poster_gen", true, {
      skills: repo,
    });
    expect(result).toEqual({
      code: 100100,
      msg: "Skill 不存在: Poster_gen",
      data: null,
    });
    expect(repo.updateAutoByCreativeSkillId).not.toHaveBeenCalled();
  });
});

describe("parseSkillMd", () => {
  it("合法 frontmatter → 提取 name/description/body", () => {
    const result = parseSkillMd(
      "---\nname: 我的技能\ndescription: 简介\n---\n正文内容",
    );
    expect(result).toEqual({
      name: "我的技能",
      description: "简介",
      body: "正文内容",
    });
  });

  it("引号包裹的值 → 去引号", () => {
    const result = parseSkillMd(
      "---\nname: \"带引号\"\ndescription: '简介'\n---\nbody",
    );
    expect(result?.name).toBe("带引号");
    expect(result?.description).toBe("简介");
  });

  it("无 frontmatter → null", () => {
    expect(parseSkillMd("纯正文，无 frontmatter")).toBeNull();
  });

  it("缺闭合 --- → null", () => {
    expect(parseSkillMd("---\nname: Test\n")).toBeNull();
  });

  it("Windows 换行（\\r\\n）→ 正常解析", () => {
    const result = parseSkillMd(
      "---\r\nname: Test\r\ndescription: Desc\r\n---\r\nbody",
    );
    expect(result?.name).toBe("Test");
    expect(result?.body).toBe("body");
  });

  it("正文中包含 --- → 正确提取", () => {
    const result = parseSkillMd(
      "---\nname: Test\ndescription: Desc\n---\nSome text\n---\nMore text",
    );
    expect(result?.body).toBe("Some text\n---\nMore text");
  });

  it("缺 name 字段 → 空字符串", () => {
    const result = parseSkillMd("---\ndescription: Desc\n---\nbody");
    expect(result?.name).toBe("");
  });
});

describe("handleCreateSkill", () => {
  it("合法 SKILL.md → 创建成功，返回 mine 视图", async () => {
    const repo = makeRepo();
    repo.createPersonalSkill.mockResolvedValue({
      creative_skill_id: "my_skill",
      name: "我的技能",
      description: "简介",
    });
    const content = "---\nname: 我的技能\ndescription: 简介\n---\n正文";
    const result = await handleCreateSkill("9", content, { skills: repo });
    expect(result.code).toBe(200);
    expect(result.data).toEqual({
      creative_skill_id: "my_skill",
      auto: false,
      name: "我的技能",
      description: "简介",
      cover_url: null,
      source: null,
      asset_domain: "personal",
    });
    expect(repo.createPersonalSkill).toHaveBeenCalledWith("9", {
      name: "我的技能",
      description: "简介",
      body: "正文",
    });
  });

  it("名称冲突 → 100101", async () => {
    const repo = makeRepo();
    repo.createPersonalSkill.mockRejectedValue(
      new SkillNameConflictError("my skill"),
    );
    const result = await handleCreateSkill(
      "9",
      "---\nname: My Skill\ndescription: Desc\n---\nbody",
      { skills: repo },
    );
    expect(result).toEqual({
      code: 100101,
      msg: "同名技能已存在",
      data: null,
    });
  });

  it("官方保留名 → 100102", async () => {
    const repo = makeRepo();
    repo.createPersonalSkill.mockRejectedValue(
      new SkillNameReservedError("poster gen"),
    );
    const result = await handleCreateSkill(
      "9",
      "---\nname: Poster Gen\ndescription: Desc\n---\nbody",
      { skills: repo },
    );
    expect(result).toEqual({
      code: 100102,
      msg: "名称与官方技能冲突",
      data: null,
    });
  });

  it("无 frontmatter → 400", async () => {
    const repo = makeRepo();
    const result = await handleCreateSkill("9", "纯正文无 frontmatter", {
      skills: repo,
    });
    expect(result.code).toBe(400);
    expect(repo.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("name 为空 → 400", async () => {
    const repo = makeRepo();
    const result = await handleCreateSkill(
      "9",
      "---\nname: \ndescription: Desc\n---\nbody",
      { skills: repo },
    );
    expect(result.code).toBe(400);
    expect(result.msg).toContain("名称");
    expect(repo.createPersonalSkill).not.toHaveBeenCalled();
  });

  it("body 为空 → 400", async () => {
    const repo = makeRepo();
    const result = await handleCreateSkill(
      "9",
      "---\nname: Test\ndescription: Desc\n---\n",
      { skills: repo },
    );
    expect(result.code).toBe(400);
    expect(result.msg).toContain("正文");
    expect(repo.createPersonalSkill).not.toHaveBeenCalled();
  });
});
