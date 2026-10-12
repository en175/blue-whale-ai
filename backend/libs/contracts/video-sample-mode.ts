import { z } from "zod";

import { canvasBindingSchema } from "./canvas-recovery.js";

const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);


export const VIDEO_STAGES = ["video", "sample", "final"] as const;
export const videoStageSchema = z.enum(VIDEO_STAGES);
export type VideoStage = z.infer<typeof videoStageSchema>;

export const SAMPLE_MODE_PARAM = "sample_mode";
export const VIDEO_SAMPLE_RESOLUTION = "480p";
export const VIDEO_FINAL_RESOLUTION = "1080p";

export const sampleModeParametersSchema = z
  .object({
    [SAMPLE_MODE_PARAM]: z.literal(true),
    resolution: z.literal(VIDEO_SAMPLE_RESOLUTION),
  })
  .strict();
export type SampleModeParameters = z.infer<typeof sampleModeParametersSchema>;


export const stageQuoteViewSchema = z
  .object({
    credits: z.number().int().positive().nullable(),
    quote_revision: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.credits === null && value.quote_revision !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "无报价时 quote_revision 必须同为 null",
        path: ["quote_revision"],
      });
    }
    if (value.credits !== null && value.quote_revision === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "有报价时必须携带 quote_revision",
        path: ["quote_revision"],
      });
    }
  });
export type StageQuoteView = z.infer<typeof stageQuoteViewSchema>;

export const confirmedSubmitFieldsSchema = z
  .object({
    expected_credits: z.number().int().positive(),
    quote_revision: z.string().min(1),
  })
  .strict();
export type ConfirmedSubmitFields = z.infer<typeof confirmedSubmitFieldsSchema>;


export const videoFinalizeQuoteRequestSchema = z.object({}).strict();

export const videoFinalizeCreateRequestSchema = confirmedSubmitFieldsSchema;
export type VideoFinalizeCreateRequest = z.infer<typeof videoFinalizeCreateRequestSchema>;

export const FINALIZE_SOURCE_UNIQUE_KEY = "source_sample_job_id";


export const FINALIZE_WINDOW_DAYS = 7;

export const FINALIZE_SAFETY_MARGIN_MS = 60 * 60 * 1000;


export function finalizeDeadlineFromUpstreamCreatedAt(
  upstreamCreatedAtMs: number,
): string {
  return new Date(
    upstreamCreatedAtMs + FINALIZE_WINDOW_DAYS * 24 * 60 * 60 * 1000 - FINALIZE_SAFETY_MARGIN_MS,
  ).toISOString();
}


export const sampleRegenerateRequestSchema = confirmedSubmitFieldsSchema.extend({
  canvas_binding: canvasBindingSchema.optional(),
});
export type SampleRegenerateRequest = z.infer<typeof sampleRegenerateRequestSchema>;


export const CHARGE_STATES = ["charged", "refunded"] as const;
export const chargeStateSchema = z.enum(CHARGE_STATES);
export type ChargeState = z.infer<typeof chargeStateSchema>;

export const JOB_STATUS_CHECKING = "checking";


export const videoStageJobProjectionSchema = z
  .object({
    video_stage: videoStageSchema,
    source_sample_job_id: decimalIdSchema.nullable(),
    final_job_id: decimalIdSchema.nullable(),
    finalize_deadline_at: z.string().nullable(),
    charge_state: chargeStateSchema.nullable(),
    actual_credits: z.number().int().nullable(),
  })
  .strict();
export type VideoStageJobProjection = z.infer<typeof videoStageJobProjectionSchema>;

export const videoStageAssetProjectionSchema = z
  .object({
    video_stage: videoStageSchema,
    source_sample_job_id: decimalIdSchema.nullable(),
    final_job_id: decimalIdSchema.nullable(),
  })
  .strict();
export type VideoStageAssetProjection = z.infer<typeof videoStageAssetProjectionSchema>;
