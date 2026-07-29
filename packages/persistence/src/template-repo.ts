import type { PrismaClient } from "@prisma/client";

/** Template 只读 repo（Prisma-backed），复用 template_card / template_card_image 表。
 *  对齐 Java TemplateServiceImpl：tags 来自枚举（见 template-tags.ts），
 *  page 按 tag_code 分页 + 图片批量装配（一次 IN 查询，无 N+1）。 */

export interface TemplateTagView {
  tag_code: string;
  label: string;
}

export interface TemplateCardView {
  title: string;
  video: string | null;
  images: string[];
  layout: string;
}

/** 对齐 Java PageVo：{records,total,current,size,pages}。 */
export interface TemplateCardPage {
  records: TemplateCardView[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

export interface TemplateRepo {
  pageByTagCode(tagCode: string, current: number, size: number): Promise<TemplateCardPage>;
}

export function createTemplateRepo(prisma: PrismaClient): TemplateRepo {
  return {
    async pageByTagCode(tagCode, current, size) {
      const where = { tag_code: tagCode, is_delete: 0 };
      const [total, cards] = await Promise.all([
        prisma.template_card.count({ where }),
        prisma.template_card.findMany({
          where,
          orderBy: { sort_order: "asc" },
          skip: (current - 1) * size,
          take: size,
        }),
      ]);

      // 批量查图片并按 cardId 分组（对齐 Java groupingBy，无 N+1）。
      const cardIds = cards.map((c) => c.id);
      const images =
        cardIds.length === 0
          ? []
          : await prisma.template_card_image.findMany({
              where: { card_id: { in: cardIds }, is_delete: 0 },
              orderBy: { sort_order: "asc" },
            });
      const imagesByCard = new Map<string, string[]>();
      for (const img of images) {
        const key = img.card_id.toString();
        const list = imagesByCard.get(key) ?? [];
        list.push(img.image_url);
        imagesByCard.set(key, list);
      }

      return {
        records: cards.map((c) => ({
          title: c.title,
          video: c.video_url,
          images: imagesByCard.get(c.id.toString()) ?? [],
          layout: c.layout,
        })),
        total,
        current,
        size,
        pages: Math.ceil(total / size),
      };
    },
  };
}
