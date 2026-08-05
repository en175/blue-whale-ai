import { z } from "zod";

import {
  capabilitySnapshotVersionSchema,
  frozenGenerationParametersSchema,
  providerPromptAssetSchema,
} from "./plan-message.js";
import {
  sceneCardGenerationRecordStatusSchema,
  videoReferenceModeSchema,
} from "./plan-application.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/** SceneCard 再生成请求（CONTEXT L49-63 / L84-89）：User 在生成编辑器中对已有 SceneCard
 *  调整参数后点"生成"提交的载荷。base 版本用于乐观并发——提交前编辑器读取的 SceneCard 与 Preset
 *  当前版本；服务端 CAS 比对，不一致零写入并返回 version_conflict 保留草稿。
 *  - parameters/reference_mode/reference_assets/capability_snapshot_version 为本次提交的新参数快照，
 *    复用 SceneCardGenerationPreset 的约束（媒体类型固定视频、必有时长）。
 *  - 媒体类型、权威 Markdown、ProviderPromptProjection 摘要由只读端点单独下发，不在本请求重复。 */
export const sceneCardRegenerationRequestSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    base_scene_card_version: z.number().int().positive(),
    base_preset_version: z.number().int().positive(),
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
        message: "SceneCard 再生成媒体类型固定为视频",
      });
    }
    if (value.parameters.duration == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "视频再生成必有时长",
      });
    }
  });

/** SceneCardGenerationRecord 的 Snapshot 投影（CONTEXT L82-88 / spec）：恢复权威的 generation origins/
 *  summaries 子集。完整 Preset 参数不进 Snapshot（省体积），编辑器打开时按需 GET 只读端点。
 *  - record_id：记录身份；
 *  - first_generation_job_id：该记录首个 GenerationJob（首次应用或本次再生成）；
 *  - plan_message_id：来源 PlanMessage（重试不创建新 Receipt，来源始终指向首次应用的 PlanMessage）。 */
export const sceneCardGenerationRecordViewSchema = z
  .object({
    record_id: decimalIdSchema,
    scene_card_id: decimalIdSchema,
    summary_status: sceneCardGenerationRecordStatusSchema,
    first_generation_job_id: decimalIdSchema,
    plan_message_id: decimalIdSchema,
  })
  .strict();

export type SceneCardRegenerationRequest = z.infer<
  typeof sceneCardRegenerationRequestSchema
>;
export type SceneCardGenerationRecordView = z.infer<
  typeof sceneCardGenerationRecordViewSchema
>;
