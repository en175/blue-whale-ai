import { describe, expect, it, vi } from "vitest";

import { createSkillAdminRepo } from "./skill-admin-repo.js";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    catalog_skills: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      groupBy: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as never;
}

describe("SkillAdminRepo — 官方技能维护", () => {
  it("setCategory 按 id 更新并带官方+存活过滤", async () => {
    const prisma = mockPrisma({ catalog_skills: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } });
    const ok = await createSkillAdminRepo(prisma).setCategory(3n, "short_video");
    expect(ok).toBe(true);
    expect(prisma.catalog_skills.updateMany).toHaveBeenCalledWith({
      where: { id: 3n, owner_user_id: 0n, is_delete: 0 },
      data: { category: "short_video" },
    });
  });

  it("setCategory 0 命中返回 false", async () => {
    const prisma = mockPrisma();
    expect(await createSkillAdminRepo(prisma).setCategory(99n, "x")).toBe(false);
  });

  it("assignCategory 批量归类并带官方+存活过滤", async () => {
    const prisma = mockPrisma({ catalog_skills: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } });
    const n = await createSkillAdminRepo(prisma).assignCategory([1n, 2n], "short_video");
    expect(n).toBe(2);
    expect(prisma.catalog_skills.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1n, 2n] }, owner_user_id: 0n, is_delete: 0 },
      data: { category: "short_video" },
    });
  });

  it("renameCategory 批量替换分类值", async () => {
    const prisma = mockPrisma({ catalog_skills: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) } });
    const n = await createSkillAdminRepo(prisma).renameCategory("film", "film_tv");
    expect(n).toBe(2);
    expect(prisma.catalog_skills.updateMany).toHaveBeenCalledWith({
      where: { owner_user_id: 0n, is_delete: 0, category: "film" },
      data: { category: "film_tv" },
    });
  });

  it("clearCategory 置 ''（未分类）", async () => {
    const prisma = mockPrisma({ catalog_skills: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } });
    await createSkillAdminRepo(prisma).clearCategory("marketing");
    expect(prisma.catalog_skills.updateMany).toHaveBeenCalledWith({
      where: { owner_user_id: 0n, is_delete: 0, category: "marketing" },
      data: { category: "" },
    });
  });

  it("listCategories 排除 '' 并聚合计数", async () => {
    const prisma = mockPrisma({
      catalog_skills: {
        groupBy: vi.fn().mockResolvedValue([
          { category: "film", _count: { _all: 3 } },
          { category: "marketing", _count: { _all: 5 } },
        ]),
      },
    });
    const cats = await createSkillAdminRepo(prisma).listCategories();
    expect(cats).toEqual([
      { name: "film", count: 3 },
      { name: "marketing", count: 5 },
    ]);
    expect(prisma.catalog_skills.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { owner_user_id: 0n, is_delete: 0, category: { not: "" } },
      }),
    );
  });

  it("listOfficialSkills 查官方行并给出正文状态（含下架行）", async () => {
    const prisma = mockPrisma({
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          id: 3n,
          creative_skill_id: "deep_writing",
          name: "深度写作",
          skill_code: "dw01",
          cover_url: null,
          category: "other",
          sort_order: 1,
          is_delete: 0,
          has_content: 1,
        },
        {
          id: 4n,
          creative_skill_id: null,
          name: "缺正文技能",
          skill_code: null,
          cover_url: null,
          category: "other",
          sort_order: 2,
          is_delete: 1,
          has_content: 0,
        },
      ]),
    });
    const rows = await createSkillAdminRepo(prisma).listOfficialSkills();
    expect(rows).toEqual([
      {
        id: "3",
        creative_skill_id: "deep_writing",
        name: "深度写作",
        skill_code: "dw01",
        cover_url: null,
        category: "other",
        sort_order: 1,
        is_delete: 0,
        has_content: true,
      },
      {
        id: "4",
        creative_skill_id: null,
        name: "缺正文技能",
        skill_code: null,
        cover_url: null,
        category: "other",
        sort_order: 2,
        is_delete: 1,
        has_content: false,
      },
    ]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("WHERE owner_user_id = 0"),
    );
  });

  it("getOfficialSkill 读官方行并映射详情", async () => {
    const prisma = mockPrisma({
      catalog_skills: {
        findFirst: vi.fn().mockResolvedValue({
          id: 3n,
          creative_skill_id: "deep_writing",
          name: "深度写作",
          skill_code: "dw01",
          description: "简介",
          content: "正文",
          category: "film",
          sort_order: 2,
          cover_url: null,
          is_delete: 0,
        }),
      },
    });
    const detail = await createSkillAdminRepo(prisma).getOfficialSkill(3n);
    expect(detail).toMatchObject({
      id: "3",
      creative_skill_id: "deep_writing",
      name: "深度写作",
      description: "简介",
      content: "正文",
      has_content: true,
      is_delete: 0,
    });
    expect(prisma.catalog_skills.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3n, owner_user_id: 0n },
      }),
    );
  });

  it("updateOfficialSkill 写名称、简介、正文与分类，限定官方行", async () => {
    const prisma = mockPrisma({
      catalog_skills: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const result = await createSkillAdminRepo(prisma).updateOfficialSkill(3n, {
      name: "深度写作二",
      description: "新简介",
      content: "新正文",
      category: "film",
    });
    expect(result).toBe("ok");
    expect(prisma.catalog_skills.updateMany).toHaveBeenCalledWith({
      where: { id: 3n, owner_user_id: 0n },
      data: expect.objectContaining({
        name: "深度写作二",
        name_key: "深度写作二",
        description: "新简介",
        content: "新正文",
        category: "film",
      }),
    });
  });

  it("updateOfficialSkill 改名撞其他官方技能 → conflict，不写库", async () => {
    const updateMany = vi.fn();
    const prisma = mockPrisma({
      catalog_skills: {
        findFirst: vi.fn().mockResolvedValue({ id: 9n }),
        updateMany,
      },
    });
    const result = await createSkillAdminRepo(prisma).updateOfficialSkill(3n, {
      name: "同名技能",
    });
    expect(result).toBe("conflict");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("updateOfficialSkill 未命中官方行 → not_found", async () => {
    const prisma = mockPrisma({
      catalog_skills: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    expect(
      await createSkillAdminRepo(prisma).updateOfficialSkill(99n, {
        content: "x",
      }),
    ).toBe("not_found");
  });

  it("setActive 可下架也可恢复（不按当前 is_delete 过滤）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = mockPrisma({
      catalog_skills: { updateMany },
    });
    expect(await createSkillAdminRepo(prisma).setActive(3n, 1)).toBe(true);
    expect(await createSkillAdminRepo(prisma).setActive(3n, 0)).toBe(true);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 3n, owner_user_id: 0n },
      data: expect.objectContaining({ is_delete: 1 }),
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 3n, owner_user_id: 0n },
      data: expect.objectContaining({ is_delete: 0 }),
    });
  });

  it("backfillOfficialAssets 只补缺 creative_skill_id 的官方行", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = mockPrisma({
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([
          { id: 3n, name: "深度写作", description: "d", content: "正文" },
          { id: 4n, name: "空技能", description: "", content: "" },
        ]),
        updateMany,
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ c: 0n }]),
    });
    expect(await createSkillAdminRepo(prisma).backfillOfficialAssets()).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 3n, owner_user_id: 0n, creative_skill_id: null },
      data: expect.objectContaining({
        creative_skill_id: expect.stringMatching(/^[a-z0-9_]+$/),
        name_key: "深度写作",
        content: "正文",
      }),
    });
  });
});
