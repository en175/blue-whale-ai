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

/** 文本附件冻结的有效媒体身份映射（IKFM3S §5）：node_id = 素材来源画布节点 id，
 *  与索引契约身份同源；快照仅供审计与核对，worker 不消费。 */
export const textAttachmentMediaSchema = z
  .object({
    node_id: z.string().min(1),
    asset_id: z.string().regex(/^[1-9][0-9]*$/),
    media_type: z.enum(["image", "video", "audio"]),
  })
  .strict();
export type TextAttachmentMedia = z.infer<typeof textAttachmentMediaSchema>;

export const textAttachmentSnapshotSchema = z
  .object({
    node_id: z.string().min(1),
    title: z.string(),
    text: z.string(),
    prompt_source: previewSourceSchema.optional(),
    media: z.array(textAttachmentMediaSchema).optional(),
  })
  .strict();
export type TextAttachmentSnapshot = z.infer<typeof textAttachmentSnapshotSchema>;
