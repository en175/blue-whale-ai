import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {createSkillRepo} from "./skill-repo.js";

import {expectWhitelistOnly} from "./skill-repo.testlib.js";

const OFFICIAL_ROW = {
  id: 3n,
  creative_skill_id: "deep_writing",
  name: "Deep Writing",
  description: "写作助手",
  cover_url: "https://x/cover.png",
  source: "official",
  skill_code: null,
  name_en: null,
  name_zh: "深度写作",
  description_en: null,
  description_zh: null,
};

const PERSONAL_ROW = {
  creative_skill_id: "my_personal",
  name: "我的技能",
  description: "个人资产",
  gmt_create: new Date("2026-01-01T00:00:00Z"),
};

describe("SkillRepo — 我的技能与个人技能生命周期", () => {
  function createUnionPrisma(
    officialRow: Record<string, unknown> | null = OFFICIAL_ROW,
  ) {
    const catalogFindMany = vi
      .fn()
      .mockImplementation((args: { where?: Record<string, unknown> }) => {
        if (args?.where?.owner_user_id !== undefined) {
          return Promise.resolve([PERSONAL_ROW]);
        }
        return Promise.resolve(officialRow ? [officialRow] : []);
      });
    const userSkillFindMany = vi.fn().mockResolvedValue([
      { skill_id: 3n, gmt_create: new Date("2026-02-01T00:00:00Z") },
    ]);
    const prisma = {
      user_skills: { findMany: userSkillFindMany },
      catalog_skills: { findMany: catalogFindMany },
    } as unknown as PrismaClient;
    return { prisma, catalogFindMany, userSkillFindMany };
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
    const { prisma } = createUnionPrisma({
      ...OFFICIAL_ROW,
      name: "深度写作",
      name_zh: null,
      name_en: null,
    });
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
    const { prisma, catalogFindMany, userSkillFindMany } = createUnionPrisma();

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
    expect(catalogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          owner_user_id: 9n,
          asset_domain: "personal",
          is_delete: 0,
        },
      }),
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
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 50,
    });

    expect(page).toEqual({ records: [], total: 0, size: 50, current: 1, pages: 0 });
  });

  it("createPersonalSkill 落一行技能本体，正文与摘要同行", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([]),
        create,
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ c: 0n }]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).createPersonalSkill("9", {
        name: "Storyboard Pro",
        description: "分镜辅助",
        body: "# Storyboard",
      }),
    ).resolves.toMatchObject({ creative_skill_id: "storyboard_pro" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creative_skill_id: "storyboard_pro",
        owner_user_id: 9n,
        asset_domain: "personal",
        name: "Storyboard Pro",
        description: "分镜辅助",
        name_key: "storyboard pro",
        body: "# Storyboard",
        source: "personal",
      }),
    });
  });

  it("deletePersonal 命中时物理删除本人技能行", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      catalog_skills: { deleteMany },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "my_personal"),
    ).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        creative_skill_id: "my_personal",
        asset_domain: "personal",
        owner_user_id: 9n,
      },
    });
  });

  it("deletePersonal 非 owner 调用不命中：不删除任何行", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      catalog_skills: { deleteMany },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("7", "my_personal"),
    ).resolves.toBe(false);
  });

  it("deletePersonal 对 official 行不删（where 带 asset_domain 谓词，即使 owner 巧合匹配）", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      catalog_skills: { deleteMany },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("0", "deep_writing"),
    ).resolves.toBe(false);
    const [args] = deleteMany.mock.calls[0];
    expect(args.where).toMatchObject({
      creative_skill_id: "deep_writing",
      asset_domain: "personal",
      owner_user_id: 0n,
    });
  });

  it("deletePersonal 写失败抛错（不吞异常）", async () => {
    const prisma = {
      catalog_skills: {
        deleteMany: vi.fn().mockRejectedValue(new Error("table missing")),
      },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "my_personal"),
    ).rejects.toThrow("table missing");
  });

  it("findPersonalContent owner 命中返回 name/description/body（契约 §13.1）", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      name: "我的技能",
      description: "个人资产",
      body: "正文内容",
    });
    const prisma = {
      catalog_skills: { findFirst },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("9", "my_personal"),
    ).resolves.toEqual({
      name: "我的技能",
      description: "个人资产",
      body: "正文内容",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        owner_user_id: 9n,
        creative_skill_id: "my_personal",
        asset_domain: "personal",
      },
      select: { name: true, description: true, body: true },
    });
  });

  it("findPersonalContent 非 owner 调用不命中（null，不泄露存在性）", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      catalog_skills: { findFirst },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("7", "my_personal"),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ owner_user_id: 7n }),
      }),
    );
  });
});
