import { describe, expect, it, vi } from "vitest";

import { handleListLibrary, handleListMine } from "./handle-skills.js";

// /api/agent/skills library/mine 只读分页。对齐 Java SkillServiceImpl。

const libItem = {
  id: "3",
  name: "海报生成",
  description: "一键海报",
  cover_url: null,
  source: "official",
  added: true,
  creative_skill_id: "poster_gen",
};

describe("handleListLibrary", () => {
  it("official + keyword 分页 → 200 + Page", async () => {
    const repo = {
      listLibrary: vi.fn().mockResolvedValue({
        records: [libItem],
        total: 1,
        size: 50,
        current: 1,
      }),
      listMine: vi.fn(),
    };
    const result = await handleListLibrary(
      "9",
      { keyword: "海报", pageNum: 1, pageSize: 50 },
      { skills: repo },
    );
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [libItem], total: 1, size: 50, current: 1 },
    });
    expect(repo.listLibrary).toHaveBeenCalledWith("9", {
      keyword: "海报",
      pageNum: 1,
      pageSize: 50,
    });
  });

  it("无 query → 默认 pageNum=1 pageSize=50 keyword=undefined", async () => {
    const repo = {
      listLibrary: vi
        .fn()
        .mockResolvedValue({ records: [], total: 0, size: 50, current: 1 }),
      listMine: vi.fn(),
    };
    await handleListLibrary("9", {}, { skills: repo });
    expect(repo.listLibrary).toHaveBeenCalledWith("9", {
      keyword: undefined,
      pageNum: 1,
      pageSize: 50,
    });
  });
});

describe("handleListMine", () => {
  it("返回我的 skills 分页 → 200", async () => {
    const mineItem = {
      skill_id: "3",
      auto: true,
      name: "海报生成",
      description: "一键海报",
      cover_url: null,
      source: "official",
      creative_skill_id: "poster_gen",
    };
    const repo = {
      listLibrary: vi.fn(),
      listMine: vi.fn().mockResolvedValue({
        records: [mineItem],
        total: 1,
        size: 50,
        current: 1,
      }),
    };
    const result = await handleListMine(
      "9",
      { pageNum: 1, pageSize: 50 },
      { skills: repo },
    );
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [mineItem], total: 1, size: 50, current: 1 },
    });
    expect(repo.listMine).toHaveBeenCalledWith("9", {
      pageNum: 1,
      pageSize: 50,
    });
  });
});
