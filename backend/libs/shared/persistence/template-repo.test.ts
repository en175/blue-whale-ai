import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createTemplateRepo } from "./template-repo.js";

function prismaWith(cards: Array<Record<string, unknown>>, images: Array<Record<string, unknown>> = []) {
  const findMany = vi.fn().mockResolvedValue(cards);
  const count = vi.fn().mockResolvedValue(cards.length);
  return {
    prisma: {
      catalog_templates: { findMany, count },
      catalog_template_images: { findMany: vi.fn().mockResolvedValue(images) },
    } as unknown as PrismaClient,
    findMany,
  };
}

describe("模板卡列表（IKRE7X）", () => {
  it("无筛选时返回全部并带标签与精选标记", async () => {
    const { prisma, findMany } = prismaWith([
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

    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0 },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 0,
      take: 10,
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
    const { prisma, findMany } = prismaWith([]);

    await createTemplateRepo(prisma).pageCards({
      tagCode: "goods",
      isFeatured: true,
      current: 2,
      size: 6,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: { is_delete: 0, tag_code: "goods", is_featured: 1 },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      skip: 6,
      take: 6,
    });
  });
});
