import type { PrismaClient } from "@prisma/client";

/** Template 只读 repo（Prisma-backed），复用 template_card / template_card_image 表。
 *  对齐 Java TemplateServiceImpl：tags 来自枚举（见 template-tags.ts），
 *  page 按 tag_code 分页 + 图片批量装配（一次 IN 查询，无 N+1）。 */

export interface TemplateTagView {
  tag_code: string;
  label: string;
}

/** 管理端标签视图（IKA64P：含可见性，隐藏标签一并返回） */
export interface TemplateTagAdminView {
  tag_code: string;
  label: string;
  /** 1 首页可见 / 0 隐藏 */
  visible: number;
}

export interface TemplateCardView {
  title: string;
  video: string | null;
  images: string[];
  layout: string;
  /** 模板提示词（IK764F）：点击卡片追加进输入框的真实内容，可为空（前端兜底 title） */
  content: string | null;
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
  /** 首页标签列表（IK764F 起读 DB template_tag 表，按 sort_order 升序；IKA64P 起仅可见） */
  listTags(): Promise<TemplateTagView[]>;
  /** 管理端标签列表（IKA64P：含隐藏，按 sort_order 升序） */
  listAllTags(): Promise<TemplateTagAdminView[]>;
}

export function createTemplateRepo(prisma: PrismaClient): TemplateRepo {
  return {
    async listTags() {
      const tags = await prisma.template_tag.findMany({
        where: { is_delete: 0, visible: 1 },
        orderBy: { sort_order: "asc" },
      });
      return tags.map((t) => ({ tag_code: t.tag_code, label: t.label }));
    },

    async listAllTags() {
      const tags = await prisma.template_tag.findMany({
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
