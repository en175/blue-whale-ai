import { z } from "zod";

/** 视频参考模式（CONTEXT L55）：预设必须具有视频参考模式。由首/尾帧角色派生。
 *  - text_to_video：无帧驱动；
 *  - first_frame / last_frame / first_and_last_frame：对应帧驱动的图生视频。 */
export const videoReferenceModeSchema = z.enum([
  "text_to_video",
  "first_frame",
  "last_frame",
  "first_and_last_frame",
]);

/** SceneCardGenerationRecord 汇总状态（CONTEXT L84-88）：只使用 生成中/部分完成/全部成功/全部失败。 */
export const sceneCardGenerationRecordStatusSchema = z.enum([
  "generating",
  "partial",
  "success",
  "failed",
]);

export type VideoReferenceMode = z.infer<typeof videoReferenceModeSchema>;
export type SceneCardGenerationRecordStatus = z.infer<
  typeof sceneCardGenerationRecordStatusSchema
>;
