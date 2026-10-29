import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {createSkillRepo} from "./skill-repo.js";

import {expectWhitelistOnly, withTransaction} from "./skill-repo.testlib.js";

describe("SkillRepo — 我的技能与个人技能生命周期", () => {
  function createUnionPrisma() {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("owner_user_id")) {
        return Promise.resolve([
          {
            creative_skill_id: "my_personal",
            name: "我的技能",
            description: "个人资产",
            gmt_create: new Date("2026-01-01T00:00:00Z"),
          },
        ]);
      }
      return Promise.resolve([
        { source_skill_id: 3n, creative_skill_id: "deep_writing" },
      ]);
    });
    const userSkillFindMany = vi
      .fn()
      .mockResolvedValue([
        { skill_id: 3n, gmt_create: new Date("2026-02-01T00:00:00Z") },
      ]);
    const prisma = {
      user_skills: { findMany: userSkillFindMany },
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "Deep Writing",
            description: "写作助手",
            cover_url: "https://x/cover.png",
            source: "official",
            name_en: null,
            name_zh: "深度写作",
            description_en: null,
            description_zh: null,
          },
        ]),
      },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;
    return { prisma, queryRawUnsafe, userSkillFindMany };
  }

  it("listMine 官方引用标题中文优先解析（name_zh → 回退单语 name），与技能库一致（IKCXOK）", async () => {
    const { prisma } = createUnionPrisma();
    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });
    expect(page.records[0]).toMatchObject({
      creative_skill_id: "deep_writing",
      name: "深度写作",
      asset_domain: "official",
    });
  });

  it("listMine 官方引用 name_zh/name_en 均缺失时回退单语 name，不返回空", async () => {
    const prisma = {
      user_skills: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n, gmt_create: new Date("2026-02-01T00:00:00Z") }]),
      },
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: null,
            source: "official",
            name_en: null,
            name_zh: null,
          },
        ]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });
    expect(page.records[0]).toMatchObject({
      name: "深度写作",
      asset_domain: "official",
    });
  });

  it("listMine 同页返回官方引用 ∪ 名下个人技能，asset_domain 分别为 official/personal", async () => {
    const { prisma, queryRawUnsafe, userSkillFindMany } = createUnionPrisma();

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.total).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "deep_writing",
        name: "深度写作",
        description: "写作助手",
        cover_url: "https://x/cover.png",
        source: "official",
        skill_code: null,
        asset_domain: "official",
      },
      {
        creative_skill_id: "my_personal",
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        skill_code: null,
        asset_domain: "personal",
      },
    ]);
    expectWhitelistOnly(page.records);
    expect(userSkillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { gmt_create: "desc" } }),
    );
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      9n,
    );
  });

  it("listMine 合并后内存切片分页，total 为合并总数", async () => {
    const { prisma } = createUnionPrisma();

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 2,
      pageSize: 1,
    });

    expect(page.total).toBe(2);
    expect(page.current).toBe(2);
    expect(page.size).toBe(1);
    expect(page.pages).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "my_personal",
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        skill_code: null,
        asset_domain: "personal",
      },
    ]);
  });

  it("listMine 空结果返回 pages = 0（hasMore 恒 false）", async () => {
    const prisma = {
      user_skills: { findMany: vi.fn().mockResolvedValue([]) },
      catalog_skills: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 50,
    });

    expect(page).toEqual({ records: [], total: 0, size: 50, current: 1, pages: 0 });
  });

  it("createPersonalSkill atomically makes its first immutable version active", async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $executeRawUnsafe: executeRawUnsafe };
    const prisma = {
      catalog_skills: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ c: 0n }])
        .mockResolvedValueOnce([{ c: 0n }]),
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).createPersonalSkill("9", {
        name: "Storyboard Pro",
        description: "分镜辅助",
        body: "# Storyboard",
      }),
    ).resolves.toMatchObject({ creative_skill_id: "storyboard_pro" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    const [skillSql, ...skillParams] = executeRawUnsafe.mock.calls[0];
    const [versionSql, versionId] = executeRawUnsafe.mock.calls[1];
    expect(skillSql).toContain("active_version_id");
    expect(versionSql).toContain("catalog_creative_skill_versions");
    expect(skillParams).toContain(versionId);
  });

  it("deletePersonal 命中时物理删除本体及其 catalog_creative_skill_versions 行", async () => {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM catalog_creative_skills")) return [{ name: "故事板助手" }];
      return [];
    });
    const executeRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("catalog_creative_skill_versions")) return 2;
      return 1;
    });
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "my_personal"),
    ).resolves.toBe(true);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM catalog_creative_skill_versions"),
      "my_personal",
    );
    for (const call of executeRawUnsafe.mock.calls) {
      expect(call[0] as string).not.toContain("creative_skill_activation");
    }
    for (const call of queryRawUnsafe.mock.calls) {
      expect(call[0] as string).not.toContain("creative_skill_activation");
    }
  });

  it("deletePersonal 非 owner 调用不命中：本体与版本行都不动", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const executeRawUnsafe = vi.fn();
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("7", "my_personal"),
    ).resolves.toBe(false);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("deletePersonal 对 official 行不删（asset_domain 谓词保护，即使 owner 巧合匹配）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const executeRawUnsafe = vi.fn();
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("0", "deep_writing"),
    ).resolves.toBe(false);
    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("SELECT name FROM catalog_creative_skills");
    expect(sql).toContain("asset_domain = 'personal'");
    expect(sql).toContain("owner_user_id = ?");
    expect(params).toEqual(["deep_writing", 0n]);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("catalog_creative_skills 读查询失败时容错为空（表不存在不阻塞主路径）；deletePersonal 写失败则抛错", async () => {
    const queryRawUnsafe = vi.fn().mockRejectedValue(new Error("table missing"));
    const executeRawUnsafe = vi.fn().mockRejectedValue(new Error("table missing"));
    const prisma = {
      user_skills: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n }]),
      },
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: null,
            source: "official",
            name_en: null,
            name_zh: null,
          },
        ]),
        count: vi.fn(),
      },
      $queryRawUnsafe: queryRawUnsafe,
      $executeRawUnsafe: executeRawUnsafe,
      $transaction: vi.fn(
        async (cb: (t: Record<string, unknown>) => Promise<unknown>) =>
          cb({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
      ),
    } as unknown as PrismaClient;
    const repo = createSkillRepo(prisma);

    const page = await repo.listMine("9", { pageNum: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.records[0]).toMatchObject({
      creative_skill_id: null,
      asset_domain: "official",
    });
    await expect(repo.resolveOfficialSkillId("deep_writing")).resolves.toBeNull();
    await expect(
      repo.findPersonalContent("9", "my_personal"),
    ).resolves.toBeNull();
    await expect(repo.deletePersonal("9", "my_personal")).rejects.toThrow(
      "table missing",
    );
  });

  it("findPersonalContent owner 命中返回 name/description/body（契约 §13.1）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { name: "我的技能", description: "个人资产", body: "正文内容" },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("9", "my_personal"),
    ).resolves.toEqual({
      name: "我的技能",
      description: "个人资产",
      body: "正文内容",
    });
    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("asset_domain = 'personal'");
    expect(sql).toContain("owner_user_id = ?");
    expect(sql).toContain("catalog_creative_skill_versions");
    expect(params).toEqual([9n, "my_personal"]);
  });

  it("findPersonalContent 非 owner 调用不命中（null，不泄露存在性）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("7", "my_personal"),
    ).resolves.toBeNull();
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      7n,
      "my_personal",
    );
  });
});
