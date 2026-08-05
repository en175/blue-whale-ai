import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSkillRepo } from "./skill-repo.js";

describe("SkillRepo 分页 pages 字段", () => {
  it("listLibrary 返回 pages = ceil(total / pageSize)", async () => {
    const total = 60;
    const pageSize = 50;
    const prisma = {
      skill: {
        count: vi.fn().mockResolvedValue(total),
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official" },
          { id: 2n, name: "技能B", description: null, cover_url: null, source: "official" },
        ]),
      },
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listLibrary("100", {
      pageNum: 1,
      pageSize,
    });

    expect(page.pages).toBe(Math.ceil(total / pageSize));
    expect(page.total).toBe(total);
    expect(page.current).toBe(1);
    expect(page.records).toHaveLength(2);
  });

  it("listLibrary 整除时 pages = total / pageSize", async () => {
    const prisma = {
      skill: {
        count: vi.fn().mockResolvedValue(100),
        findMany: vi.fn().mockResolvedValue([]),
      },
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listLibrary("100", {
      pageNum: 2,
      pageSize: 50,
    });

    expect(page.pages).toBe(2);
    expect(page.current).toBe(2);
  });

  it("listMine 空结果早退分支返回 pages = 0（hasMore 恒 false）", async () => {
    const userSkillFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      user_skill: {
        count: vi.fn().mockResolvedValue(0),
        findMany: userSkillFindMany,
      },
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("100", {
      pageNum: 1,
      pageSize: 50,
    });

    expect(page).toEqual({ records: [], total: 0, size: 50, current: 1, pages: 0 });
    expect(page.pages).toBe(0);
  });

  it("listMine 非空返回 pages = ceil(total / pageSize)", async () => {
    const prisma = {
      skill: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official" },
        ]),
      },
      user_skill: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          { skill_id: 1n, auto: 1 },
          { skill_id: 2n, auto: 0 },
          { skill_id: 3n, auto: 0 },
        ]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("100", {
      pageNum: 1,
      pageSize: 2,
    });

    expect(page.pages).toBe(Math.ceil(3 / 2));
    expect(page.total).toBe(3);
    expect(page.records).toHaveLength(3);
  });
});
