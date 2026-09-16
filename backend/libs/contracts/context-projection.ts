import { z } from "zod";

/** 资产受限投影（T08，IK67H3）：复用 T04 mention 接纳冻结的字段集，
 *  **不含 storage_key / url / user_id** —— Agent 只拿到产品投影 + 临时访问能力。
 *  抽到独立模块供 MentionInputSnapshot（agent-runtime）与 PlanMessage（plan-message）共享，
 *  避免两份契约文件互相 import 形成循环依赖。 */
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

/** 场景卡片受限投影（T08）：title/summary/content_markdown/version。 */
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
