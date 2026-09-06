import type { PrismaClient } from "@prisma/client";

/** 旧生成卡迁移历史行（IKDLQK）：只增不改；迁移后节点编辑/删除不影响已冻结内容。 */
export interface LegacyCardHistoryRow {
  id: bigint;
  project_id: bigint;
  node_id: string;
  title: string;
  prompt_text: string;
  visual_text: string | null;
  source_json: unknown;
  card_json: unknown;
  gmt_create: Date;
}

/** 迁移落库前的历史草稿：字段来自迁移时实际保存的卡片内容。 */
export interface LegacyCardHistoryDraft {
  nodeId: string;
  title: string;
  promptText: string;
  visualText: string | null;
  source: unknown;
  cardJson: unknown;
}

export interface LegacyCardHistoryRepo {
  /** 本项目全部历史（id 升序）；无记录返回空数组。 */
  listByProject(projectId: string): Promise<LegacyCardHistoryRow[]>;
  /** 迁移先落历史再转画布；(project_id, node_id) 唯一，并发只接受首个。 */
  rememberMany(projectId: string, rows: LegacyCardHistoryDraft[]): Promise<void>;
}

export function createLegacyCardHistoryRepo(prisma: PrismaClient): LegacyCardHistoryRepo {
  return {
    async listByProject(projectId) {
      return prisma.legacy_card_history.findMany({
        where: { project_id: BigInt(projectId) },
        orderBy: { id: "asc" },
      });
    },
    async rememberMany(projectId, rows) {
      if (rows.length === 0) return;
      await prisma.legacy_card_history.createMany({
        data: rows.map((row) => ({
          project_id: BigInt(projectId),
          node_id: row.nodeId,
          title: row.title,
          prompt_text: row.promptText,
          visual_text: row.visualText,
          // Prisma nullable Json 不接受 undefined 值，只能省略键（对齐 conversation-quote-repo）
          ...(row.source != null ? { source_json: row.source } : {}),
          card_json: row.cardJson ?? {},
        })),
        skipDuplicates: true,
      });
    },
  };
}
