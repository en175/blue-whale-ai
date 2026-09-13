import { z } from "zod";

export const previewSourceSchema = z.object({
  sessionId: z.string().min(1).max(128),
  revisionId: z.string().min(1).max(128),
  shotNo: z.number().int().positive(),
}).strict();
export const applyPreviewSchema = z.object({
  source: previewSourceSchema,
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
}).strict();
export type PromptPreviewSource = z.infer<typeof previewSourceSchema>;
