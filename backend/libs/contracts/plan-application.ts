import { z } from "zod";

export const videoReferenceModeSchema = z.enum([
  "text_to_video",
  "first_frame",
  "last_frame",
  "first_and_last_frame",
]);

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
