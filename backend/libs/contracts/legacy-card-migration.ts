import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";

/** 旧生成卡迁移历史条目（IKDLQK）：迁移时冻结的只读事实；节点后续编辑或删除不回写。 */
export const legacyCardHistoryItemSchema = z.object({
  historyId: z.string().min(1),
  nodeId: z.string().min(1),
  title: z.string(),
  promptText: z.string(),
  visualText: z.string().nullable(),
  source: previewSourceSchema.nullable(),
  cardJson: z.unknown(),
  migratedAt: z.string(),
}).strict();

/** 迁移失败条目（IKDLQK）：原卡保留在画布上，reason 面向用户展示。 */
export const legacyMigrationFailureSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string(),
  reason: z.string().min(1),
}).strict();

/** 打开响应可选携带的迁移报告（IKDLQK）：仅当本轮发生迁移或存在失败时出现。 */
export const legacyMigrationReportSchema = z.object({
  migrated: z.array(z.string()),
  failed: z.array(legacyMigrationFailureSchema),
}).strict();

export type LegacyCardHistoryItem = z.infer<typeof legacyCardHistoryItemSchema>;
export type LegacyMigrationFailure = z.infer<typeof legacyMigrationFailureSchema>;
export type LegacyMigrationReport = z.infer<typeof legacyMigrationReportSchema>;
