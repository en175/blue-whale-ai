import type { PrismaClient } from "@prisma/client";


export interface TemplateTagView {
  tag_code: string;
  label: string;
}

export interface TemplateTagAdminView {
  tag_code: string;
  label: string;
  visible: number;
}

export interface TemplateCardView {
  title: string;
  video: string | null;
  images: string[];
  layout: string;
  content: string | null;
}

export interface TemplateCardPage {
  records: TemplateCardView[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

export interface TemplateRepo {
  pageByTagCode(tagCode: string, current: number, size: number): Promise<TemplateCardPage>;
  listTags(): Promise<TemplateTagView[]>;
  listAllTags(): Promise<TemplateTagAdminView[]>;
}

export function createTemplateRepo(prisma: PrismaClient): TemplateRepo {
  return {
    async listTags() {
      const tags = await prisma.catalog_template_tags.findMany({
        where: { is_delete: 0, visible: 1 },
        orderBy: { sort_order: "asc" },
      });
      return tags.map((t) => ({ tag_code: t.tag_code, label: t.label }));
    },

    async listAllTags() {
      const tags = await prisma.catalog_template_tags.findMany({
        where: { is_delete: 0 },
        orderBy: { sort_order: "asc" },
      });
      return tags.map((t) => ({
        tag_code: t.tag_code,
        label: t.label,
        visible: t.visible,
      }));
    },

    async pageByTagCode(tagCode, current, size) {
      const where = { tag_code: tagCode, is_delete: 0 };
      const [total, cards] = await Promise.all([
        prisma.catalog_templates.count({ where }),
        prisma.catalog_templates.findMany({
          where,
          orderBy: { sort_order: "asc" },
          skip: (current - 1) * size,
          take: size,
        }),
      ]);

      const cardIds = cards.map((c) => c.id);
      const images =
        cardIds.length === 0
          ? []
          : await prisma.catalog_template_images.findMany({
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
          content: c.content,
        })),
        total,
        current,
        size,
        pages: Math.ceil(total / size),
      };
    },
  };
}
