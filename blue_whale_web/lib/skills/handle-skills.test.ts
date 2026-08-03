import { describe, expect, it, vi } from "vitest";

import { handleListLibrary, handleListMine } from "./handle-skills.js";

// /api/agent/skills library/mine 只读分页。
// 契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §3/§11：
// wire 主键 creative_skill_id，响应只含白名单字段（content/body/prompt/自增 id 永不出库）；
// library v2 请求体扩展 keyword/category/sort/lang，非法枚举按参数错误拒绝。

const libItem = {
  creative_skill_id: "poster_gen",
  name: "海报生成",
  description: "一键海报",
  cover_url: null,
  source: "official",
  asset_domain: "official",
  added: true,
  category: "marketing",
  usage_count: 12,
};

describe("handleListLibrary", () => {
  it("official + keyword 分页 → 200 + Page（白名单字段）", async () => {
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
      category: undefined,
      sort: undefined,
      lang: undefined,
      pageNum: 1,
      pageSize: 50,
    });
  });

  it("category/sort/lang 透传给 repo", async () => {
    const repo = {
      listLibrary: vi
        .fn()
        .mockResolvedValue({ records: [], total: 0, size: 50, current: 1 }),
      listMine: vi.fn(),
    };
    await handleListLibrary(
      "9",
      { category: "film", sort: "most_used", lang: "en" },
      { skills: repo },
    );
    expect(repo.listLibrary).toHaveBeenCalledWith("9", {
      keyword: undefined,
      category: "film",
      sort: "most_used",
      lang: "en",
      pageNum: 1,
      pageSize: 50,
    });
  });

  it("非法 category/sort/lang 按参数错误拒绝，不触碰 repo", async () => {
    const repo = {
      listLibrary: vi.fn(),
      listMine: vi.fn(),
    };
    for (const query of [
      { category: "bogus" },
      { sort: "bogus" },
      { lang: "fr" },
    ]) {
      const result = await handleListLibrary("9", query as never, {
        skills: repo,
      });
      expect(result.code).toBe(400);
      expect(result.data).toBeNull();
    }
    expect(repo.listLibrary).not.toHaveBeenCalled();
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
      category: undefined,
      sort: undefined,
      lang: undefined,
      pageNum: 1,
      pageSize: 50,
    });
  });

  it("repo 多带字段时响应只含白名单（显式 pick，不透传）", async () => {
    const repo = {
      listLibrary: vi.fn().mockResolvedValue({
        records: [
          {
            ...libItem,
            id: "3",
            content: "SECRET_CONTENT",
            prompt: "SECRET_PROMPT",
          },
        ],
        total: 1,
        size: 50,
        current: 1,
        pages: 99,
      }),
      listMine: vi.fn(),
    };
    const result = await handleListLibrary("9", {}, { skills: repo });
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [libItem], total: 1, size: 50, current: 1 },
    });
  });

  it("响应 JSON 序列化后不含 content/body/prompt 键（防泄露）", async () => {
    const repo = {
      listLibrary: vi.fn().mockResolvedValue({
        records: [
          {
            ...libItem,
            content: "SECRET_CONTENT",
            body: "SECRET_BODY",
            prompt: "SECRET_PROMPT",
          },
        ],
        total: 1,
        size: 50,
        current: 1,
      }),
      listMine: vi.fn(),
    };
    const result = await handleListLibrary("9", {}, { skills: repo });
    const json = JSON.stringify(result);
    for (const banned of ['"content"', '"body"', '"prompt"']) {
      expect(json).not.toContain(banned);
    }
    for (const secret of ["SECRET_CONTENT", "SECRET_BODY", "SECRET_PROMPT"]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("handleListMine", () => {
  const mineItem = {
    creative_skill_id: "poster_gen",
    auto: true,
    name: "海报生成",
    description: "一键海报",
    cover_url: null,
    source: "official",
    asset_domain: "official",
  };

  it("返回我的 skills 分页 → 200（白名单字段）", async () => {
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

  it("repo 多带字段时响应只含白名单（显式 pick，不透传）", async () => {
    const repo = {
      listLibrary: vi.fn(),
      listMine: vi.fn().mockResolvedValue({
        records: [
          {
            ...mineItem,
            skill_id: "3",
            content: "SECRET_CONTENT",
            version: 7,
          },
        ],
        total: 1,
        size: 50,
        current: 1,
        pages: 99,
      }),
    };
    const result = await handleListMine("9", {}, { skills: repo });
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: { records: [mineItem], total: 1, size: 50, current: 1 },
    });
  });

  it("响应 JSON 序列化后不含 content/body/prompt 键（防泄露）", async () => {
    const repo = {
      listLibrary: vi.fn(),
      listMine: vi.fn().mockResolvedValue({
        records: [
          {
            ...mineItem,
            content: "SECRET_CONTENT",
            body: "SECRET_BODY",
            prompt: "SECRET_PROMPT",
          },
        ],
        total: 1,
        size: 50,
        current: 1,
      }),
    };
    const result = await handleListMine("9", {}, { skills: repo });
    const json = JSON.stringify(result);
    for (const banned of ['"content"', '"body"', '"prompt"']) {
      expect(json).not.toContain(banned);
    }
    for (const secret of ["SECRET_CONTENT", "SECRET_BODY", "SECRET_PROMPT"]) {
      expect(json).not.toContain(secret);
    }
  });
});
