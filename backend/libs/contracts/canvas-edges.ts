import { z } from "zod";
import { previewSourceSchema } from "./prompt-preview.js";

export const CANVAS_EDGE_LIMITS = { maxEdges: 500, fieldMax: 128, edgesBytes: 262_144 } as const;

export const canvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    source: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    target: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

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
