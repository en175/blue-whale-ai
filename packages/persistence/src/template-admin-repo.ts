import type { PrismaClient } from "@prisma/client";

/**
 * 模板管理 admin repo（IK764F，Prisma-backed）。
 *
 * 复用 template_card / template_card_image / template_tag 表：
 * - 卡片删除一律软删（is_delete=1），可恢复；查询端（首页 + admin 列表）都按 is_delete=0 过滤。
 * - tag 仅可改 label（tag_code/sort_order 固定）；卡片 move = 同 tag 内交换排序位。
 * - 图片随卡片整体同步（保留/软删/新增），moveImage 同卡片内交换排序位。
 * 调序实现：把同组（tag 内卡片 / 卡片内图片）按 (sort_order, id) 排序后整体重排为
 * 0..n-1 连续值——顺带归一化历史数据里可能存在的重复 sort_order。
 */

export type MoveDirection = "up" | "down";

/** 入参业务错误（如图片 id 不属于目标卡片）：路由层映射 400，与系统错误（500）区分。 */
export class TemplateAdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateAdminInputError";
  }
}

export interface MoveResult {
  ok: boolean;
  /** 失败原因：not_found（目标不存在/已删）| boundary（已在边缘） */
  reason?: "not_found" | "boundary";
}

export interface AdminTemplateImageView {
  id: string;
  image_url: string;
  sort_order: number;
}

export interface AdminTemplateCardView {
  id: string;
  tag_code: string;
  title: string;
  content: string | null;
  video_url: string | null;
  layout: string;
  sort_order: number;
  images: AdminTemplateImageView[];
}

/** 新建/编辑卡片的输入；images 数组顺序即目标展示顺序。 */
export interface TemplateCardInput {
  tag_code: string;
  title: string;
  content: string | null;
  video_url: string | null;
  layout: string;
  sort_order: number;
  images: Array<{ id?: string; image_url: string }>;
}

export interface TemplateAdminRepo {
  renameTag(tagCode: string, label: string): Promise<boolean>;
  listCards(tagCode?: string): Promise<AdminTemplateCardView[]>;
  getCard(id: bigint): Promise<AdminTemplateCardView | null>;
  createCard(input: TemplateCardInput): Promise<string>;
  updateCard(id: bigint, input: TemplateCardInput): Promise<boolean>;
  softDeleteCard(id: bigint): Promise<boolean>;
  moveCard(id: bigint, direction: MoveDirection): Promise<MoveResult>;
  moveImage(imageId: bigint, direction: MoveDirection): Promise<MoveResult>;
}

/** 把序列中 index 处元素与上/下邻居交换；越界或 index 无效 → null（纯函数，便于单测）。 */
export function swapSequence<T>(
  items: readonly T[],
  index: number,
  direction: MoveDirection,
): T[] | null {
  const swapIdx = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIdx < 0 || swapIdx >= items.length) return null;
  const result = [...items];
  const tmp = result[index]!;
  result[index] = result[swapIdx]!;
  result[swapIdx] = tmp;
  return result;
}

async function assembleCards(
  prisma: PrismaClient,
  cards: Array<{
    id: bigint;
    tag_code: string;
    title: string;
    content: string | null;
    video_url: string | null;
    layout: string;
    sort_order: number;
  }>,
): Promise<AdminTemplateCardView[]> {
  if (cards.length === 0) return [];
  const cardIds = cards.map((c) => c.id);
  const images = await prisma.template_card_image.findMany({
    where: { card_id: { in: cardIds }, is_delete: 0 },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
  });
  const byCard = new Map<string, AdminTemplateImageView[]>();
  for (const img of images) {
    const key = img.card_id.toString();
    const list = byCard.get(key) ?? [];
    list.push({
      id: img.id.toString(),
      image_url: img.image_url,
      sort_order: img.sort_order,
    });
    byCard.set(key, list);
  }
  return cards.map((c) => ({
    id: c.id.toString(),
    tag_code: c.tag_code,
    title: c.title,
    content: c.content,
    video_url: c.video_url,
    layout: c.layout,
    sort_order: c.sort_order,
    images: byCard.get(c.id.toString()) ?? [],
  }));
}

export function createTemplateAdminRepo(prisma: PrismaClient): TemplateAdminRepo {
  return {
    async renameTag(tagCode, label) {
      const result = await prisma.template_tag.updateMany({
        where: { tag_code: tagCode, is_delete: 0 },
        data: { label, update_time: new Date() },
      });
      return result.count > 0;
    },

    async listCards(tagCode?) {
      const cards = await prisma.template_card.findMany({
        where: { is_delete: 0, ...(tagCode ? { tag_code: tagCode } : {}) },
        orderBy: [{ tag_code: "asc" }, { sort_order: "asc" }, { id: "asc" }],
      });
      return assembleCards(prisma, cards);
    },

    async getCard(id) {
      const card = await prisma.template_card.findFirst({
        where: { id, is_delete: 0 },
      });
      if (!card) return null;
      const [view] = await assembleCards(prisma, [card]);
      return view ?? null;
    },

    async createCard(input) {
      return prisma.$transaction(async (tx) => {
        const now = new Date();
        const card = await tx.template_card.create({
          data: {
            tag_code: input.tag_code,
            title: input.title,
            content: input.content,
            video_url: input.video_url,
            layout: input.layout,
            sort_order: input.sort_order,
            update_time: now,
            gmt_modified: now,
          },
        });
        if (input.images.length > 0) {
          await tx.template_card_image.createMany({
            data: input.images.map((img, i) => ({
              card_id: card.id,
              image_url: img.image_url,
              sort_order: i,
              update_time: now,
              gmt_modified: now,
            })),
          });
        }
        return card.id.toString();
      });
    },

    async updateCard(id, input) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.template_card.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!existing) return false;

        const now = new Date();
        await tx.template_card.update({
          where: { id },
          data: {
            tag_code: input.tag_code,
            title: input.title,
            content: input.content,
            video_url: input.video_url,
            layout: input.layout,
            sort_order: input.sort_order,
            update_time: now,
            gmt_modified: now,
          },
        });

        // 图片同步：入参带 id 的保留（按入参顺序重排 sort_order），缺失的软删，无 id 的新增。
        const keepIds = input.images
          .filter((img) => img.id !== undefined)
          .map((img) => BigInt(img.id as string));
        const current = await tx.template_card_image.findMany({
          where: { card_id: id, is_delete: 0 },
        });
        // 越权防护：保留的 image id 必须全部属于本卡片当前存活图片，且不得重复；
        // 否则伪造 id 可跨卡片改写他人图片（image id 自增易枚举）。
        const currentIds = new Set(current.map((img) => img.id.toString()));
        const seen = new Set<string>();
        for (const kid of keepIds) {
          const key = kid.toString();
          if (!currentIds.has(key) || seen.has(key)) {
            throw new TemplateAdminInputError("图片 id 无效或不属于该卡片");
          }
          seen.add(key);
        }
        const toDelete = current.filter((img) => !keepIds.includes(img.id));
        if (toDelete.length > 0) {
          await tx.template_card_image.updateMany({
            where: { id: { in: toDelete.map((img) => img.id) } },
            data: { is_delete: 1, update_time: now, gmt_modified: now },
          });
        }
        await Promise.all(
          input.images.map((img, i) =>
            img.id !== undefined
              ? tx.template_card_image.update({
                  where: { id: BigInt(img.id) },
                  data: {
                    image_url: img.image_url,
                    sort_order: i,
                    update_time: now,
                    gmt_modified: now,
                  },
                })
              : tx.template_card_image.create({
                  data: {
                    card_id: id,
                    image_url: img.image_url,
                    sort_order: i,
                    update_time: now,
                    gmt_modified: now,
                  },
                }),
          ),
        );
        return true;
      });
    },

    async softDeleteCard(id) {
      const result = await prisma.template_card.updateMany({
        where: { id, is_delete: 0 },
        data: { is_delete: 1, update_time: new Date(), gmt_modified: new Date() },
      });
      return result.count > 0;
    },

    async moveCard(id, direction) {
      return prisma.$transaction(async (tx) => {
        const target = await tx.template_card.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!target) return { ok: false, reason: "not_found" as const };

        const siblings = await tx.template_card.findMany({
          where: { tag_code: target.tag_code, is_delete: 0 },
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        });
        const idx = siblings.findIndex((c) => c.id === id);
        const swapped = swapSequence(siblings, idx, direction);
        if (!swapped) return { ok: false, reason: "boundary" as const };
        // 整体重排为连续值，归一化历史重复 sort_order
        await Promise.all(
          swapped.map((c, i) =>
            c.sort_order === i
              ? Promise.resolve()
              : tx.template_card.update({
                  where: { id: c.id },
                  data: {
                    sort_order: i,
                    update_time: new Date(),
                    gmt_modified: new Date(),
                  },
                }),
          ),
        );
        return { ok: true };
      });
    },

    async moveImage(imageId, direction) {
      return prisma.$transaction(async (tx) => {
        const target = await tx.template_card_image.findFirst({
          where: { id: imageId, is_delete: 0 },
        });
        if (!target) return { ok: false, reason: "not_found" as const };

        const siblings = await tx.template_card_image.findMany({
          where: { card_id: target.card_id, is_delete: 0 },
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        });
        const idx = siblings.findIndex((img) => img.id === imageId);
        const swapped = swapSequence(siblings, idx, direction);
        if (!swapped) return { ok: false, reason: "boundary" as const };
        await Promise.all(
          swapped.map((img, i) =>
            img.sort_order === i
              ? Promise.resolve()
              : tx.template_card_image.update({
                  where: { id: img.id },
                  data: {
                    sort_order: i,
                    update_time: new Date(),
                    gmt_modified: new Date(),
                  },
                }),
          ),
        );
        return { ok: true };
      });
    },
  };
}
