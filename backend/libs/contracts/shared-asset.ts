import { z } from "zod";

export const SHARED_ASSET_TYPES = ["card", "media", "goods", "scene", "text"] as const;
export const sharedAssetTypeSchema = z.enum(SHARED_ASSET_TYPES);
export type SharedAssetType = z.infer<typeof sharedAssetTypeSchema>;

export const CARD_KINDS = ["style", "character", "object", "environment", "custom"] as const;
export const MEDIA_KINDS = ["image", "video", "audio"] as const;
export const SHARED_ASSET_KINDS = [...CARD_KINDS, ...MEDIA_KINDS] as const;
export const sharedAssetKindSchema = z.enum(SHARED_ASSET_KINDS);
export type SharedAssetKind = z.infer<typeof sharedAssetKindSchema>;

export const sharedAssetCardSnapshotSchema = z
  .object({
    referenceImages: z.array(z.object({ id: z.string(), src: z.string() })).default([]),
    description: z.string().optional(),
    voice: z.object({ name: z.string(), src: z.string() }).optional(),
  })
  .strict();
export type SharedAssetCardSnapshot = z.infer<typeof sharedAssetCardSnapshotSchema>;

export const sharedAssetGoodsSnapshotSchema = z
  .object({
    name: z.string().min(1).max(255),
    detail: z.string().optional(),
    images: z
      .array(
        z
          .object({ id: z.string(), src: z.string(), enabled: z.boolean().optional() })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type SharedAssetGoodsSnapshot = z.infer<typeof sharedAssetGoodsSnapshotSchema>;

export const sharedAssetTextSnapshotSchema = z.object({ text: z.string().min(1), html: z.string().min(1).optional() }).strict();
export type SharedAssetTextSnapshot = z.infer<typeof sharedAssetTextSnapshotSchema>;

export const sharedAssetMediaSnapshotSchema = z
  .object({
    url: z.string().min(1),
    mime: z.string().nullable().optional(),
    size: z.number().int().nonnegative().nullable().optional(),
    width: z.number().int().nonnegative().nullable().optional(),
    height: z.number().int().nonnegative().nullable().optional(),
    duration: z.number().nullable().optional(),
  })
  .strict();
export type SharedAssetMediaSnapshot = z.infer<typeof sharedAssetMediaSnapshotSchema>;

export const sharedAssetSceneSnapshotSchema = z
  .object({
    title: z.string().min(1).max(255),
    summary: z.string().nullable().optional(),
    contentMarkdown: z.string().min(1),
    generationPreset: z
      .object({
        parameters: z.unknown(),
        referenceMode: z.string(),
        referenceAssets: z.array(z.unknown()),
        capabilitySnapshotVersion: z.unknown(),
      })
      .nullable()
      .optional(),
  })
  .strict();
export type SharedAssetSceneSnapshot = z.infer<typeof sharedAssetSceneSnapshotSchema>;

export type SharedAssetSnapshot =
  | SharedAssetCardSnapshot
  | SharedAssetGoodsSnapshot
  | SharedAssetTextSnapshot
  | SharedAssetMediaSnapshot
  | SharedAssetSceneSnapshot;

export const sharedAssetSnapshotSchema = z.union([
  sharedAssetCardSnapshotSchema,
  sharedAssetGoodsSnapshotSchema,
  sharedAssetTextSnapshotSchema,
  sharedAssetMediaSnapshotSchema,
  sharedAssetSceneSnapshotSchema,
]);

export const saveSharedAssetRequestSchema = z.discriminatedUnion("assetType", [
  z
    .object({
      assetType: z.literal("card"),
      kind: z.enum(CARD_KINDS),
      snapshot: sharedAssetCardSnapshotSchema,
    })
    .strict(),
  z
    .object({
      assetType: z.literal("media"),
      kind: z.enum(MEDIA_KINDS),
      sourceAssetId: z.string().regex(/^[1-9][0-9]*$/),
      name: z.string().max(255).optional(),
    })
    .strict(),
  z
    .object({
      assetType: z.literal("goods"),
      snapshot: sharedAssetGoodsSnapshotSchema,
    })
    .strict(),
  z
    .object({
      assetType: z.literal("scene"),
      sourceSceneCardId: z.string().regex(/^[1-9][0-9]*$/),
    })
    .strict(),
  z
    .object({
      assetType: z.literal("text"),
      snapshot: sharedAssetTextSnapshotSchema,
    })
    .strict(),
]);
export type SaveSharedAssetRequest = z.infer<typeof saveSharedAssetRequestSchema>;

export const sharedAssetViewSchema = z.object({
  id: z.string(),
  assetType: sharedAssetTypeSchema,
  kind: sharedAssetKindSchema.nullable(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  snapshot: sharedAssetSnapshotSchema,
  status: z.enum(["normal", "invalid"]),
  createdAt: z.string(),
});
export type SharedAssetView = z.infer<typeof sharedAssetViewSchema>;

export const saveSharedAssetResultSchema = z.object({
  created: z.boolean(),
  item: sharedAssetViewSchema,
});
export type SaveSharedAssetResult = z.infer<typeof saveSharedAssetResultSchema>;

export const sharedAssetListQuerySchema = z.object({
  assetType: z.enum(SHARED_ASSET_TYPES).optional(),
  kind: z.enum(SHARED_ASSET_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export type SharedAssetListQuery = z.infer<typeof sharedAssetListQuerySchema>;

export const sharedAssetPageViewSchema = z.object({
  records: z.array(sharedAssetViewSchema),
  total: z.number().int(),
  size: z.number().int(),
  current: z.number().int(),
});
export type SharedAssetPageView = z.infer<typeof sharedAssetPageViewSchema>;

export const addSharedAssetToProjectRequestSchema = z
  .object({
    projectId: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();
export type AddSharedAssetToProjectRequest = z.infer<
  typeof addSharedAssetToProjectRequestSchema
>;

export const addSharedAssetToProjectResultSchema = z.object({
  sceneCardId: z.string(),
});
export type AddSharedAssetToProjectResult = z.infer<
  typeof addSharedAssetToProjectResultSchema
>;
