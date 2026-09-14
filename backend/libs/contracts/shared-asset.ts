import { z } from "zod";

/** 共享资产类型（IK9QKP）：两层结构，对齐画布节点。
 *  第一层 asset_type = 画布 node.type 归一（card/media/goods/scene/text）；
 *  第二层 kind = 节点内的判别字段（card 的 data.kind、media 的 data.mediaType）。 */
export const SHARED_ASSET_TYPES = ["card", "media", "goods", "scene", "text"] as const;
export const sharedAssetTypeSchema = z.enum(SHARED_ASSET_TYPES);
export type SharedAssetType = z.infer<typeof sharedAssetTypeSchema>;

/** 第二层判别值：卡片 kind（data.kind）+ 媒体 kind（data.mediaType）。 */
export const CARD_KINDS = ["style", "character", "object", "environment", "custom"] as const;
export const MEDIA_KINDS = ["image", "video", "audio"] as const;
export const SHARED_ASSET_KINDS = [...CARD_KINDS, ...MEDIA_KINDS] as const;
export const sharedAssetKindSchema = z.enum(SHARED_ASSET_KINDS);
export type SharedAssetKind = z.infer<typeof sharedAssetKindSchema>;

/** 卡片快照（style/character/object/environment/custom 卡）：参考图 + 描述；角色卡额外音色。
 *  对齐画布 assetNode 的 data（kind 已由第一层字段承载）。 */
export const sharedAssetCardSnapshotSchema = z
  .object({
    referenceImages: z.array(z.object({ id: z.string(), src: z.string() })).default([]),
    description: z.string().optional(),
    voice: z.object({ name: z.string(), src: z.string() }).optional(),
  })
  .strict();
export type SharedAssetCardSnapshot = z.infer<typeof sharedAssetCardSnapshotSchema>;

/** 商品快照：对齐画布 productNode 的 data（{ name, detail, images }，images 元素含 enabled）。 */
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

/** 文本快照：富文本内容。 */
export const sharedAssetTextSnapshotSchema = z.object({ html: z.string().min(1) }).strict();
export type SharedAssetTextSnapshot = z.infer<typeof sharedAssetTextSnapshotSchema>;

/** 媒体快照（保存时从 assets 源行抓取，自包含不依赖源表）。
 *  kind 由第一层字段承载，不在快照内重复。 */
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

/** 场景卡快照（保存时从 scene_cards + generation_presets 抓取，复制回目标项目时原样还原）。 */
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

/** 五种快照的联合（视图/添加回画布用；assetType/kind 在同级字段，前端据此收窄）。 */
export const sharedAssetSnapshotSchema = z.union([
  sharedAssetCardSnapshotSchema,
  sharedAssetGoodsSnapshotSchema,
  sharedAssetTextSnapshotSchema,
  sharedAssetMediaSnapshotSchema,
  sharedAssetSceneSnapshotSchema,
]);

/** 保存请求：按 assetType 判别联合。
 *  卡片/媒体带第二层 kind；卡片/商品/文本快照前端直传；媒体/场景传源 id、后端抓取快照。 */
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

/** 共享资产视图（面板网格 + 添加回画布）。 */
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

/** 保存结果：created=false 表示已存在（幂等/近似去重），item 为既有项。 */
export const saveSharedAssetResultSchema = z.object({
  created: z.boolean(),
  item: sharedAssetViewSchema,
});
export type SaveSharedAssetResult = z.infer<typeof saveSharedAssetResultSchema>;

/** 面板列表查询：第一层 assetType + 第二层 kind 双维过滤（均可缺省 = 不过滤）+ 分页。 */
export const sharedAssetListQuerySchema = z.object({
  assetType: z.enum(SHARED_ASSET_TYPES).optional(),
  kind: z.enum(SHARED_ASSET_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export type SharedAssetListQuery = z.infer<typeof sharedAssetListQuerySchema>;

/** 面板列表分页视图。 */
export const sharedAssetPageViewSchema = z.object({
  records: z.array(sharedAssetViewSchema),
  total: z.number().int(),
  size: z.number().int(),
  current: z.number().int(),
});
export type SharedAssetPageView = z.infer<typeof sharedAssetPageViewSchema>;

/** 添加回画布（场景卡）：把共享场景卡快照复制为目标项目的 scene_cards 实体。 */
export const addSharedAssetToProjectRequestSchema = z
  .object({
    projectId: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();
export type AddSharedAssetToProjectRequest = z.infer<
  typeof addSharedAssetToProjectRequestSchema
>;

/** 添加回画布（场景卡）结果。 */
export const addSharedAssetToProjectResultSchema = z.object({
  sceneCardId: z.string(),
});
export type AddSharedAssetToProjectResult = z.infer<
  typeof addSharedAssetToProjectResultSchema
>;
