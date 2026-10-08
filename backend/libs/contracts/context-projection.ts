import { z } from "zod";

export const assetContextProjectionSchema = z
  .object({
    asset_type: z.string().min(1),
    mime: z.string().nullable(),
    size: z.string().regex(/^[0-9]+$/).nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    duration_ms: z.number().int().nullable(),
    content_sha256: z.string().nullable(),
  })
  .strict();

export const sceneCardContextProjectionSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().nullable(),
    content_markdown: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

export type AssetContextProjection = z.infer<
  typeof assetContextProjectionSchema
>;
export type SceneCardContextProjection = z.infer<
  typeof sceneCardContextProjectionSchema
>;
