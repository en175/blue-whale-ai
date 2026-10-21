import { describe, expect, it, vi } from "vitest";

import {
  createHomepageHeroRepo,
  HOMEPAGE_HERO_MAX_ENABLED,
  HomepageHeroLimitError,
  type HomepageHeroRepo,
} from "./homepage-hero-repo.js";

function row(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-09-01T00:00:00Z");
  return {
    id: 1n,
    scene: "homepage",
    media_type: "video",
    media_url: "https://tos.example.com/v.mp4",
    poster_url: "https://tos.example.com/p.jpg",
    sort_order: 0,
    enabled: 1,
    gmt_create: now,
    gmt_modified: now,
    ...overrides,
  };
}

function mockPrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    homepage_hero: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      aggregate: vi.fn().mockResolvedValue({ _max: { sort_order: null } }),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(row({ id: 1n })),
      update: vi.fn().mockResolvedValue(row()),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...(overrides.homepage_hero ?? {}),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    ...(overrides.$transaction !== undefined ? { $transaction: overrides.$transaction } : {}),
  } as never;
  return prisma as unknown as {
    homepage_hero: Record<string, ReturnType<typeof vi.fn>>;
    $transaction: ReturnType<typeof vi.fn>;
  };
}

function repoOf(prisma: ReturnType<typeof mockPrisma>): HomepageHeroRepo {
  return createHomepageHeroRepo(prisma as never);
}

describe("homepage_hero repo — 首页背景配置", () => {
  it("listAll 只取指定场景的存活条目并按 sort_order 升序", async () => {
    const prisma = mockPrisma({
      homepage_hero: {
        findMany: vi.fn().mockResolvedValue([
          row({ id: 1n, sort_order: 0 }),
          row({ id: 2n, sort_order: 1 }),
        ]),
      },
    });
    const list = await repoOf(prisma).listAll("auth");
    expect(prisma.homepage_hero.findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, scene: "auth" },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    });
    expect(list.map((r) => Number(r.id))).toEqual([1, 2]);
    expect(list[0]).toEqual(
      expect.objectContaining({
        id: "1",
        scene: "homepage",
        media_type: "video",
        media_url: "https://tos.example.com/v.mp4",
        poster_url: "https://tos.example.com/p.jpg",
        sort_order: 0,
        enabled: 1,
      }),
    );
  });

  it("listEnabled 只返回指定场景 enabled=1 存活条目，且只 select 公开 5 字段", async () => {
    const prisma = mockPrisma({
      homepage_hero: {
        findMany: vi.fn().mockResolvedValue([
          row({ id: 3n, media_type: "image", poster_url: null }),
        ]),
      },
    });
    const list = await repoOf(prisma).listEnabled("auth");
    expect(prisma.homepage_hero.findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, enabled: 1, scene: "auth" },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      select: {
        id: true,
        media_type: true,
        media_url: true,
        poster_url: true,
        sort_order: true,
      },
    });
    expect(list).toEqual([
      { id: "3", media_type: "image", media_url: "https://tos.example.com/v.mp4", poster_url: null, sort_order: 0 },
    ]);
  });

  it("getById 命中存活条目返回字符串 id；已删/不存在返回 null", async () => {
    const prisma = mockPrisma({
      homepage_hero: { findFirst: vi.fn().mockResolvedValue(row({ id: 5n })) },
    });
    const found = await repoOf(prisma).getById(5n);
    expect(prisma.homepage_hero.findFirst).toHaveBeenCalledWith({
      where: { id: 5n, is_delete: 0 },
    });
    expect(found?.id).toBe("5");
    expect(found?.enabled).toBe(1);

    const miss = mockPrisma();
    expect(await repoOf(miss).getById(99n)).toBeNull();
  });

  it("create 缺省 sort_order 取同场景 max+1；未显式禁用时校验同场景上限 8 条", async () => {
    const prisma = mockPrisma({
      homepage_hero: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sort_order: 3 } }),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(row({ id: 9n })),
      },
    });
    const id = await repoOf(prisma).create({
      scene: "auth",
      media_type: "video",
      media_url: "https://tos.example.com/new.mp4",
    });
    expect(id).toBe("9");
    expect(prisma.homepage_hero.count).toHaveBeenCalledWith({
      where: { is_delete: 0, enabled: 1, scene: "auth" },
    });
    expect(prisma.homepage_hero.aggregate).toHaveBeenCalledWith({
      where: { is_delete: 0, scene: "auth" },
      _max: { sort_order: true },
    });
    expect(prisma.homepage_hero.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scene: "auth",
          media_type: "video",
          sort_order: 4,
          enabled: 1,
        }),
      }),
    );
  });

  it("create 显式传 sort_order / enabled=0 时不再校验上限", async () => {
    const prisma = mockPrisma({});
    await repoOf(prisma).create({
      scene: "homepage",
      media_type: "image",
      media_url: "https://tos.example.com/i.png",
      sort_order: 7,
      enabled: 0,
    });
    expect(prisma.homepage_hero.count).not.toHaveBeenCalled();
    expect(prisma.homepage_hero.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sort_order: 7, enabled: 0 }),
      }),
    );
  });

  it("create 启用数已达上限时抛 HomepageHeroLimitError", async () => {
    const prisma = mockPrisma({
      homepage_hero: { count: vi.fn().mockResolvedValue(HOMEPAGE_HERO_MAX_ENABLED) },
    });
    await expect(
      repoOf(prisma).create({ scene: "homepage", media_type: "image", media_url: "https://x/i.png" }),
    ).rejects.toThrow(HomepageHeroLimitError);
  });

  it("update 从禁用改启用（0→1）时校验上限", async () => {
    const prisma = mockPrisma({
      homepage_hero: {
        findFirst: vi.fn().mockResolvedValue(row({ id: 2n, enabled: 0 })),
        count: vi.fn().mockResolvedValue(HOMEPAGE_HERO_MAX_ENABLED),
        update: vi.fn().mockResolvedValue(row()),
      },
    });
    await expect(
      repoOf(prisma).update(2n, { enabled: 1 }),
    ).rejects.toThrow(HomepageHeroLimitError);
    const prisma2 = mockPrisma({
      homepage_hero: {
        findFirst: vi.fn().mockResolvedValue(row({ id: 2n, enabled: 1 })),
        update: vi.fn().mockResolvedValue(row()),
      },
    });
    expect(await repoOf(prisma2).update(2n, { enabled: 1 })).toBe(true);
    expect(prisma2.homepage_hero.count).not.toHaveBeenCalled();
  });

  it("update 未命中存活条目返回 false；poster_url 显式传 null 可清空", async () => {
    const prisma = mockPrisma({ homepage_hero: { findFirst: vi.fn().mockResolvedValue(null) } });
    expect(await repoOf(prisma).update(9n, { poster_url: null })).toBe(false);

    const prisma2 = mockPrisma({
      homepage_hero: {
        findFirst: vi.fn().mockResolvedValue(row({ id: 2n })),
        update: vi.fn().mockResolvedValue(row()),
      },
    });
    await repoOf(prisma2).update(2n, { poster_url: null });
    expect(prisma2.homepage_hero.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ poster_url: null }) }),
    );
  });

  it("softDelete 仅命中存活条目（updateMany + is_delete=0）", async () => {
    const prisma = mockPrisma({
      homepage_hero: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    expect(await repoOf(prisma).softDelete(3n)).toBe(true);
    expect(prisma.homepage_hero.updateMany).toHaveBeenCalledWith({
      where: { id: 3n, is_delete: 0 },
      data: expect.objectContaining({ is_delete: 1 }),
    });
    const miss = mockPrisma();
    expect(await repoOf(miss).softDelete(99n)).toBe(false);
  });

  it("move 上移与下一位交换并整体重排为连续值", async () => {
    const rows = [
      row({ id: 1n, sort_order: 0 }),
      row({ id: 2n, sort_order: 1 }),
      row({ id: 3n, sort_order: 2 }),
    ];
    const prisma = mockPrisma({
      homepage_hero: {
        findFirst: vi.fn().mockResolvedValue(rows[2]),
        findMany: vi.fn().mockResolvedValue(rows),
        update: vi.fn().mockResolvedValue(row()),
      },
    });
    const res = await repoOf(prisma).move(3n, "up");
    expect(res).toEqual({ ok: true });
    expect(prisma.homepage_hero.findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, scene: "homepage" },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    });
    const calls = prisma.homepage_hero.update.mock.calls.map((c) => c[0].data.sort_order);
    expect(calls.sort()).toEqual([1, 2]);
  });

  it("move 边界：首条上移 / 末条下移 → boundary；目标不存在 → not_found", async () => {
    const rows = [row({ id: 1n, sort_order: 0 }), row({ id: 2n, sort_order: 1 })];
    const prisma = mockPrisma({
      homepage_hero: {
        findFirst: vi.fn().mockResolvedValue(rows[0]),
        findMany: vi.fn().mockResolvedValue(rows),
      },
    });
    expect(await repoOf(prisma).move(1n, "up")).toEqual({ ok: false, reason: "boundary" });

    const prisma2 = mockPrisma({ homepage_hero: { findFirst: vi.fn().mockResolvedValue(null) } });
    expect(await repoOf(prisma2).move(99n, "up")).toEqual({ ok: false, reason: "not_found" });
  });

  it("countEnabled 统计指定场景 enabled=1 存活条目", async () => {
    const prisma = mockPrisma({
      homepage_hero: { count: vi.fn().mockResolvedValue(5) },
    });
    expect(await repoOf(prisma).countEnabled("homepage")).toBe(5);
    expect(prisma.homepage_hero.count).toHaveBeenCalledWith({
      where: { is_delete: 0, enabled: 1, scene: "homepage" },
    });
  });
});
