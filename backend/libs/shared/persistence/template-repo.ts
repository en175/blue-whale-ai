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
  tag_code: string;
  title: string;
  video: string | null;
  images: string[];
  layout: string;
  content: string | null;
  is_featured: number;
}

export interface TemplateCardPage {
  records: TemplateCardView[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

export interface TemplateCardQuery {
  tagCode?: string;
  isFeatured?: boolean;
  current: number;
  size: number;
}

export interface TemplateRepo {
  pageCards(query: TemplateCardQuery): Promise<TemplateCardPage>;
  listTags(): Promise<TemplateTagView[]>;
  listAllTags(): Promise<TemplateTagAdminView[]>;
}

async function visibleTagCodes(prisma: PrismaClient, tagCode?: string): Promise<string[]> {
  const tags = await prisma.catalog_template_tags.findMany({
    where: { is_delete: 0, visible: 1, ...(tagCode ? { tag_code: tagCode } : {}) },
    select: { tag_code: true },
  });
  return tags.map((t) => t.tag_code);
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

    async pageCards(query) {
      const where = {
        is_delete: 0,
        tag_code: { in: await visibleTagCodes(prisma, query.tagCode) },
        ...(query.isFeatured ? { is_featured: 1 } : {}),
      };
      const [total, cards] = await Promise.all([
        prisma.catalog_templates.count({ where }),
        prisma.catalog_templates.findMany({
          where,
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
          skip: (query.current - 1) * query.size,
          take: query.size,
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
          tag_code: c.tag_code,
          title: c.title,
          video: c.video_url,
          images: imagesByCard.get(c.id.toString()) ?? [],
          layout: c.layout,
          content: c.content,
          is_featured: c.is_featured,
        })),
        total,
        current: query.current,
        size: query.size,
        pages: Math.ceil(total / query.size),
      };
    },
  };
}
