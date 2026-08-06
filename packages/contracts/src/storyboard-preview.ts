import { z } from "zod";

import {
  capabilitySnapshotVersionSchema,
} from "./plan-message.js";
import {
  sceneCardGenerationRecordStatusSchema,
  type SceneCardGenerationRecordStatus,
} from "./plan-application.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

/** StoryboardPreview 画格参数（CONTEXT L43-47）：一次分镜预览 = 一个 type=image 的 GenerationJob，
 *  expected_output_count = count（默认 4），N 个 output_slot 按 slot_index 升序即镜头顺序。
 *  画格走图片生成通道，与视频通道物理隔离（CONTEXT _Avoid_ L47：排除"视频模型关键帧组"）；
 *  不携带 duration（图片无时长）。provider_id / format 由所选 model_id 的能力快照决定，不在请求中重复。 */
export const storyboardPreviewParametersSchema = z
  .object({
    model_id: z.string().min(1),
    size: z.string().min(1),
    aspect_ratio: z.string().min(1),
    count: z.number().int().min(1).max(4).default(4),
  })
  .strict();

/** StoryboardPreview 创建请求（CONTEXT L43-47 / L55-56）：User 从 SceneCard 显式触发的旁路操作，
 *  不走 PlanMessage——image_generate receipt 契约禁止 scene_card_id（CONTEXT L218），
 *  而 StoryboardPreview 必须绑定来源 SceneCard，故走独立路由 + 独立聚合表。
 *  - base_scene_card_version：触发时读取的 SceneCard 版本，服务端 CAS 比对，不一致零写入返回 version_conflict；
 *  - parameters：本次画格参数快照（model_id 必须与 capability_snapshot_version.model_id 一致）；
 *  - capability_snapshot_version：冻结时所用 image 能力行版本 + digest，应用前检测能力漂移。
 *  Idempotency-Key header 携带 CommandId；同 Key 重放返回首次结果，不同内容 100302（idempotency_conflict）。 */
export const storyboardPreviewCreateRequestSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    base_scene_card_version: z.number().int().positive(),
    parameters: storyboardPreviewParametersSchema,
    capability_snapshot_version: capabilitySnapshotVersionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.capability_snapshot_version.capability_type !== "image") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "StoryboardPreview 能力类型固定为图片",
        path: ["capability_snapshot_version", "capability_type"],
      });
    }
    if (value.parameters.model_id !== value.capability_snapshot_version.model_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameters.model_id 与冻结能力快照的 model_id 必须一致",
        path: ["parameters", "model_id"],
      });
    }
  });

/** StoryboardPreview 持久记录（CONTEXT L43-47）：从 SceneCard 触发的分镜预览会话聚合根 + SceneCard 绑定 + 幂等键。
 *  - first_generation_job_id：本次预览对应的 type=image 的 GenerationJob（画格即其 output_slots 的 Asset）；
 *  - summary_status：复用四态枚举（generating/partial/success/failed），与 SceneCardGenerationRecord 同语义；
 *  - capability_snapshot_version：冻结能力快照（漂移检测基准）。 */
export const storyboardPreviewSchema = z
  .object({
    preview_id: decimalIdSchema,
    scene_card_id: decimalIdSchema,
    project_id: decimalIdSchema,
    first_generation_job_id: decimalIdSchema,
    summary_status: sceneCardGenerationRecordStatusSchema,
    capability_snapshot_version: capabilitySnapshotVersionSchema,
  })
  .strict();

/** StoryboardPreview 的 Snapshot/SSE 投影（CONTEXT L43-47）：恢复权威的预览会话子集。
 *  画格（output_slots → Asset）通过 first_generation_job_id 关联 GenerationJob 取画格序列，不在此视图重复。 */
export const storyboardPreviewViewSchema = z
  .object({
    preview_id: decimalIdSchema,
    scene_card_id: decimalIdSchema,
    first_generation_job_id: decimalIdSchema,
    summary_status: sceneCardGenerationRecordStatusSchema,
  })
  .strict();

export type StoryboardPreviewParameters = z.infer<
  typeof storyboardPreviewParametersSchema
>;
export type StoryboardPreviewCreateRequest = z.infer<
  typeof storyboardPreviewCreateRequestSchema
>;
export type StoryboardPreview = z.infer<typeof storyboardPreviewSchema>;
export type StoryboardPreviewView = z.infer<
  typeof storyboardPreviewViewSchema
>;
// SceneCardGenerationRecordStatus 复用，保持与同族枚举一致的导出形态。
export type { SceneCardGenerationRecordStatus };
