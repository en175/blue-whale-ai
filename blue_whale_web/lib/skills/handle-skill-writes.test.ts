import { describe, expect, it, vi } from "vitest";

import { handleAddSkill, handleRemoveSkill, handleUpdateSkillAuto } from "./handle-skill-writes.js";

// skills 写操作：add（加入我的）/ remove（移除）/ updateAuto（切开关）。
// 对齐 Java SkillServiceImpl。

function makeRepo() {
  return {
    skillExists: vi.fn(),
    addReference: vi.fn(),
    removeReference: vi.fn(),
    updateAuto: vi.fn(),
  };
}

describe("handleAddSkill", () => {
  it("skill 存在 → 200 + 加入", async () => {
    const repo = makeRepo();
    repo.skillExists.mockResolvedValue(true);
    const result = await handleAddSkill("9", "3", { skills: repo });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.addReference).toHaveBeenCalledWith("9", "3");
  });

  it("skill 不存在 → 100100", async () => {
    const repo = makeRepo();
    repo.skillExists.mockResolvedValue(false);
    const result = await handleAddSkill("9", "999", { skills: repo });
    expect(result).toEqual({ code: 100100, msg: "Skill 不存在: 999", data: null });
    expect(repo.addReference).not.toHaveBeenCalled();
  });
});

describe("handleRemoveSkill", () => {
  it("命中 → 200", async () => {
    const repo = makeRepo();
    repo.removeReference.mockResolvedValue(true);
    const result = await handleRemoveSkill("9", "3", { skills: repo });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.removeReference).toHaveBeenCalledWith("9", "3");
  });

  it("未添加 → 仍 200（幂等，对齐 Java delete 不报错）", async () => {
    const repo = makeRepo();
    repo.removeReference.mockResolvedValue(false);
    const result = await handleRemoveSkill("9", "3", { skills: repo });
    expect(result.code).toBe(200);
  });
});

describe("handleUpdateSkillAuto", () => {
  it("命中 → 200", async () => {
    const repo = makeRepo();
    repo.updateAuto.mockResolvedValue(true);
    const result = await handleUpdateSkillAuto("9", "3", true, { skills: repo });
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(repo.updateAuto).toHaveBeenCalledWith("9", "3", true);
  });

  it("未添加 → 100100", async () => {
    const repo = makeRepo();
    repo.updateAuto.mockResolvedValue(false);
    const result = await handleUpdateSkillAuto("9", "3", false, { skills: repo });
    expect(result).toEqual({ code: 100100, msg: "未添加该 Skill，无法设置 auto", data: null });
  });
});
