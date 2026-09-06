import { z } from "zod";

export const CANVAS_EDGE_LIMITS = { maxEdges: 500, fieldMax: 128, edgesBytes: 262_144 } as const;

export const canvasEdgeSchema = z
  .object({
    id: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    source: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
    target: z.string().min(1).max(CANVAS_EDGE_LIMITS.fieldMax),
  })
  .strict();
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;

export const textAttachmentSnapshotSchema = z
  .object({
    node_id: z.string().min(1),
    title: z.string(),
    text: z.string(),
  })
  .strict();
export type TextAttachmentSnapshot = z.infer<typeof textAttachmentSnapshotSchema>;
