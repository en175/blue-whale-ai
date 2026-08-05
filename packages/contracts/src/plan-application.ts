import { z } from "zod";

import {
  capabilitySnapshotVersionSchema,
  frozenGenerationParametersSchema,
  providerPromptAssetSchema,
} from "./plan-message.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** PlanApplicationReceipt 公共字段（契约 §9 / CONTEXT L217-221）：一次成功应用 PlanMessage 的
 *  不可变事实。证明正文与完整参数来自被点击的 PlanMessage，记录应用时间、首个 GenerationJob 与
 *  CommandId；不修改 PlanMessage，Canvas 放置也不属于其成功条件。 */
const receiptCommon = z.object({
  message_id: decimalIdSchema,
  content_digest: digestSchema,
  applied_at: z.string().min(1),
  first_generation_job_id: decimalIdSchema,
  command_id: z.string().min(1),
});

/** PlanApplicationReceipt（契约 §9 / CONTEXT L217-221）：判别联合（含 image_generate 占位，
 *  供 T10 后续补图片分支）。视频路径（create/replace）额外记录结果 SceneCard、结果版本、scene_card_id
 *  与生成预设摘要；图片路径不携带 scene_card_id（CONTEXT _Avoid_ L208）。
 *  - image_generate：禁止 scene_card_id；
 *  - scene_card_create：scene_card_id + 结果版本 + 预设摘要；
 *  - scene_card_replace：额外 target_scene_card_mention_id（本轮唯一可用 SceneCardMention 句柄，
 *    为 T12 预留，T11 不实例化）。 */
export const planApplicationReceiptSchema = z.discriminatedUnion("application_kind", [
  receiptCommon
    .extend({ application_kind: z.literal("image_generate") })
    .strict(),
  receiptCommon
    .extend({
      application_kind: z.literal("scene_card_create"),
      scene_card_id: decimalIdSchema,
      result_version: z.number().int().positive(),
      preset_digest: digestSchema,
    })
    .strict(),
  receiptCommon
    .extend({
      application_kind: z.literal("scene_card_replace"),
      scene_card_id: decimalIdSchema,
      result_version: z.number().int().positive(),
      preset_digest: digestSchema,
      target_scene_card_mention_id: decimalIdSchema,
    })
    .strict(),
]);

/** 视频参考模式（CONTEXT L55）：预设必须具有视频参考模式。由首/尾帧角色派生。
 *  - text_to_video：无帧驱动；
 *  - first_frame / last_frame / first_and_last_frame：对应帧驱动的图生视频。 */
export const videoReferenceModeSchema = z.enum([
  "text_to_video",
  "first_frame",
  "last_frame",
  "first_and_last_frame",
]);

/** SceneCardGenerationPreset（CONTEXT L49-58）：由 SceneCard 持久拥有、供下一次直接视频生成默认使用
 *  的完整参数。首次应用 PlanMessage 时从其冻结参数创建；媒体类型固定为视频，必有时长与视频参考模式。
 *  首/尾帧角色由 reference_assets 的 role 表达，只能指向 PlanMessage 正文中已验证的素材引用；
 *  修改预设不得改写历史 PlanMessage 或 GenerationJob。 */
export const sceneCardGenerationPresetSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    parameters: frozenGenerationParametersSchema,
    reference_mode: videoReferenceModeSchema,
    reference_assets: z.array(providerPromptAssetSchema),
    capability_snapshot_version: capabilitySnapshotVersionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.parameters.capability_type !== "video") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SceneCardGenerationPreset 媒体类型固定为视频",
      });
    }
    if (value.parameters.duration == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "视频预设必有时长",
      });
    }
  });

/** SceneCardGenerationRecord 汇总状态（CONTEXT L84-88）：只使用 生成中/部分完成/全部成功/全部失败。 */
export const sceneCardGenerationRecordStatusSchema = z.enum([
  "generating",
  "partial",
  "success",
  "failed",
]);

/** SceneCardGenerationRecord（CONTEXT L82-86）：User 从 SceneCard 发起的一次新生成及其后续重试的
 *  用户可见聚合。首次应用产生的 GenerationJob 失败也归入该记录；重试不得创建新 SceneCard 或
 *  PlanApplicationReceipt。来源指向 PlanMessage 与应用回执。 */
export const sceneCardGenerationRecordSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    summary_status: sceneCardGenerationRecordStatusSchema,
    plan_message_id: decimalIdSchema,
    application_receipt_id: decimalIdSchema,
    first_generation_job_id: decimalIdSchema,
  })
  .strict();

export type PlanApplicationReceipt = z.infer<
  typeof planApplicationReceiptSchema
>;
export type VideoReferenceMode = z.infer<typeof videoReferenceModeSchema>;
export type SceneCardGenerationPreset = z.infer<
  typeof sceneCardGenerationPresetSchema
>;
export type SceneCardGenerationRecordStatus = z.infer<
  typeof sceneCardGenerationRecordStatusSchema
>;
export type SceneCardGenerationRecord = z.infer<
  typeof sceneCardGenerationRecordSchema
>;
