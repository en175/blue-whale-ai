import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createTemplateRepo } from "./template-repo.js";

function prismaWith(
  cards: Array<Record<string, unknown>>,
  images: Array<Record<string, unknown>> = [],
  tags: Array<{ tag_code: string }> = [{ tag_code: "goods" }, { tag_code: "video" }],
) {
  const findMany = vi.fn().mockResolvedValue(cards);
  const count = vi.fn().mockResolvedValue(cards.length);
  const tagsFindMany = vi.fn(
    async ({ where }: { where: { tag_code?: string } }) =>
      tags.filter((t) => !where.tag_code || t.tag_code === where.tag_code),
  );
  return {
    prisma: {
      catalog_templates: { findMany, count },
      catalog_template_images: { findMany: vi.fn().mockResolvedValue(images) },
      catalog_template_tags: { findMany: tagsFindMany },
    } as unknown as PrismaClient,
    findMany,
    count,
    tagsFindMany,
  };
}

describe("模板卡列表（IKRE7X）", () => {
  it("无筛选时返回全部并带标签与精选标记", async () => {
    const { prisma, findMany, count, tagsFindMany } = prismaWith([
      {
        id: 1n,
        tag_code: "goods",
        title: "商品展示",
        video_url: null,
        content: "提示词",
        layout: "wide",
        is_featured: 1,
      },
    ]);

    const page = await createTemplateRepo(prisma).pageCards({ current: 1, size: 10 });

    expect(tagsFindMany).toHaveBeenCalledWith({
      where: { is_delete: 0, visible: 1 },
      select: { tag_code: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: ["goods", "video"] } },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 0,
      take: 10,
    });
    expect(count).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: ["goods", "video"] } },
    });
    expect(page.records[0]).toEqual({
      tag_code: "goods",
      title: "商品展示",
      video: null,
      images: [],
      layout: "wide",
      content: "提示词",
      is_featured: 1,
    });
  });

  it("按标签与精选取交集", async () => {
    const { prisma, findMany, count, tagsFindMany } = prismaWith([]);

    await createTemplateRepo(prisma).pageCards({
      tagCode: "goods",
      isFeatured: true,
      current: 2,
      size: 6,
    });

    expect(tagsFindMany).toHaveBeenCalledWith({
      where: { is_delete: 0, visible: 1, tag_code: "goods" },
      select: { tag_code: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: ["goods"] }, is_featured: 1 },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 6,
      take: 6,
    });
    expect(count).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: ["goods"] }, is_featured: 1 },
    });
  });
});

describe("首页隐藏过滤", () => {

  it("隐藏标签的卡片不进入首页列表", async () => {
    const { prisma, findMany } = prismaWith([], [], [{ tag_code: "image" }]);

    await createTemplateRepo(prisma).pageCards({ isFeatured: true, current: 1, size: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: ["image"] }, is_featured: 1 },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 0,
      take: 50,
    });
  });

  it("直接查询隐藏标签返回空", async () => {
    const { prisma, findMany, tagsFindMany } = prismaWith([], [], [{ tag_code: "image" }]);

    await createTemplateRepo(prisma).pageCards({ tagCode: "video", current: 1, size: 50 });

    expect(tagsFindMany).toHaveBeenCalledWith({
      where: { is_delete: 0, visible: 1, tag_code: "video" },
      select: { tag_code: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: { in: [] } },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 0,
      take: 50,
    });
  });
});
