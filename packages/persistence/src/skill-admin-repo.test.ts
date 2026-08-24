import { describe, expect, it, vi } from "vitest";

import { createSkillAdminRepo } from "./skill-admin-repo.js";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    skill: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  } as never;
}

describe("SkillAdminRepo — 官方技能分类管理", () => {
  it("setCategory 按 id 更新并带 official+存活过滤", async () => {
    const prisma = mockPrisma({ updateMany: vi.fn().mockResolvedValue({ count: 1 }) });
    const ok = await createSkillAdminRepo(prisma).setCategory(3n, "short_video");
    expect(ok).toBe(true);
    expect(prisma.skill.updateMany).toHaveBeenCalledWith({
      where: { id: 3n, source: "official", is_delete: 0 },
      data: { category: "short_video" },
    });
  });

  it("setCategory 0 命中返回 false", async () => {
    const prisma = mockPrisma();
    expect(await createSkillAdminRepo(prisma).setCategory(99n, "x")).toBe(false);
  });

  it("assignCategory 批量归类并带 official+存活过滤", async () => {
    const prisma = mockPrisma({ updateMany: vi.fn().mockResolvedValue({ count: 2 }) });
    const n = await createSkillAdminRepo(prisma).assignCategory([1n, 2n], "short_video");
    expect(n).toBe(2);
    expect(prisma.skill.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1n, 2n] }, source: "official", is_delete: 0 },
      data: { category: "short_video" },
    });
  });

  it("renameCategory 批量替换分类值", async () => {
    const prisma = mockPrisma({ updateMany: vi.fn().mockResolvedValue({ count: 2 }) });
    const n = await createSkillAdminRepo(prisma).renameCategory("film", "film_tv");
    expect(n).toBe(2);
    expect(prisma.skill.updateMany).toHaveBeenCalledWith({
      where: { source: "official", is_delete: 0, category: "film" },
      data: { category: "film_tv" },
    });
  });

  it("clearCategory 置 ''（未分类）", async () => {
    const prisma = mockPrisma({ updateMany: vi.fn().mockResolvedValue({ count: 1 }) });
    await createSkillAdminRepo(prisma).clearCategory("marketing");
    expect(prisma.skill.updateMany).toHaveBeenCalledWith({
      where: { source: "official", is_delete: 0, category: "marketing" },
      data: { category: "" },
    });
  });

  it("listCategories 排除 '' 并聚合计数", async () => {
    const prisma = mockPrisma({
      groupBy: vi.fn().mockResolvedValue([
        { category: "film", _count: { _all: 3 } },
        { category: "marketing", _count: { _all: 5 } },
      ]),
    });
    const cats = await createSkillAdminRepo(prisma).listCategories();
    expect(cats).toEqual([
      { name: "film", count: 3 },
      { name: "marketing", count: 5 },
    ]);
    expect(prisma.skill.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "official", is_delete: 0, category: { not: "" } },
      }),
    );
  });

  it("listOfficialSkills 映射 id 为字符串并按 sort_order 升序请求", async () => {
    const prisma = mockPrisma({
      findMany: vi.fn().mockResolvedValue([
        { id: 3n, name: "深度写作", cover_url: null, category: "other", sort_order: 1 },
      ]),
    });
    const rows = await createSkillAdminRepo(prisma).listOfficialSkills();
    expect(rows).toEqual([
      { id: "3", name: "深度写作", cover_url: null, category: "other", sort_order: 1 },
    ]);
    expect(prisma.skill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "official", is_delete: 0 } }),
    );
  });
});
