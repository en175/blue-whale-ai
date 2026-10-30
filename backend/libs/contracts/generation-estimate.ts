import { z } from "zod";

export const generationEstimateReferenceSchema = z
  .object({
    type: z.enum(["image", "video"]),
    duration: z.number().positive().optional(),
  })
  .strict();

export type GenerationEstimateReference = z.infer<typeof generationEstimateReferenceSchema>;

export const generationEstimateRequestSchema = z
  .object({
    type: z.enum(["image", "video"]),
    parameters: z.record(z.string(), z.unknown()),
    expected_output_count: z.number().int().positive().optional(),
    references: z.array(generationEstimateReferenceSchema).optional(),
  })
  .strict();

export type GenerationEstimateRequest = z.infer<typeof generationEstimateRequestSchema>;

export const generationEstimateViewSchema = z
  .object({
    credits: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type GenerationEstimateView = z.infer<typeof generationEstimateViewSchema>;
