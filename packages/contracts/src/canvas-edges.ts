import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";

export const CANVAS_EDGE_LIMITS = { maxEdges: 500, fieldMax: 128, edgesBytes: 262_144 } as const;

/** 连线持久形状：{id, source, target} + 可选 data。
 *  data 承载连线关系属性（IKDMQS 视频参考角色 refRole: first/last/reference，缺省普通参考），
 *  原样存取不解释；渲染细节（流光样式、选中态）仍不持久化。 */
export const canvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    source: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    target: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export const textAttachmentSnapshotSchema = z
  .object({
    node_id: z.string().min(1),
    title: z.string(),
    text: z.string(),
    prompt_source: previewSourceSchema.optional(),
  })
  .strict();
export type TextAttachmentSnapshot = z.infer<typeof textAttachmentSnapshotSchema>;
