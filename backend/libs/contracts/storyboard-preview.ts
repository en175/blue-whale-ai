import { z } from "zod";

import { canvasBindingSchema } from "./canvas-recovery.js";
import {
  capabilitySnapshotVersionSchema,
} from "./plan-message.js";
import {
  sceneCardGenerationRecordStatusSchema,
  type SceneCardGenerationRecordStatus,
} from "./plan-application.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);

export const storyboardPreviewParametersSchema = z
  .object({
    model_id: z.string().min(1),
    size: z.string().min(1),
    aspect_ratio: z.string().min(1),
    count: z.number().int().min(1).max(4).default(4),
  })
  .strict();

export const storyboardPreviewCreateRequestSchema = z
  .object({
    scene_card_id: decimalIdSchema,
    base_scene_card_version: z.number().int().positive(),
    parameters: storyboardPreviewParametersSchema,
    capability_snapshot_version: capabilitySnapshotVersionSchema,
    canvas_binding: canvasBindingSchema.optional(),
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

export const storyboardFrameViewSchema = z
  .object({
    slot_id: decimalIdSchema,
    asset_id: decimalIdSchema,
    slot_index: z.number().int().nonnegative(),
  })
  .strict();

export type { SceneCardGenerationRecordStatus };
export type StoryboardFrameView = z.infer<typeof storyboardFrameViewSchema>;
