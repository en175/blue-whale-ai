import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";

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

export const legacyMigrationFailureSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string(),
  reason: z.string().min(1),
}).strict();

export const legacyMigrationReportSchema = z.object({
  migrated: z.array(z.string()),
  failed: z.array(legacyMigrationFailureSchema),
}).strict();

export type LegacyCardHistoryItem = z.infer<typeof legacyCardHistoryItemSchema>;
export type LegacyMigrationFailure = z.infer<typeof legacyMigrationFailureSchema>;
export type LegacyMigrationReport = z.infer<typeof legacyMigrationReportSchema>;
