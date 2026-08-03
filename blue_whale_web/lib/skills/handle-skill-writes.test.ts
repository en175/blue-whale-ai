import { describe, expect, it, vi } from "vitest";

import {
  handleAddSkill,
  handleRemoveSkill,
  handleUpdateSkillAuto,
} from "./handle-skill-writes.js";

// skills 写操作：add（加入我的）/ remove（移除）/ updateAuto（切开关）。
// 契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§6/§7：
// 入参一律 creative_skill_id（^[a-z][a-z0-9_]{2,79}$），格式非法/未知/个人域 → 100100。

function makeRepo() {
  return {
    resolveOfficialSkillId: vi.fn(),
    addReference: vi.fn(),
    removeReferenceByCreativeSkillId: vi.fn(),
    updateAutoByCreativeSkillId: vi.fn(),
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
