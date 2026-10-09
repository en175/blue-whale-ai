import { z } from "zod";

import {
  assetContextProjectionSchema,
  sceneCardContextProjectionSchema,
} from "./context-projection.js";


const decimalIdSchema = z.string().regex(/^[1-9][0-9]*$/);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const capabilitySnapshotVersionSchema = z
  .object({
    schema_version: z.literal(1),
    capability_type: z.enum(["image", "video"]),
    model_id: z.string().min(1),
    provider_id: z.string().min(1),
    row_version: z.number().int().nonnegative(),
    digest: digestSchema,
  })
  .strict();

const assetDerivedReferenceSchema = z
  .object({
    mention_id: decimalIdSchema,
    mention_seq: z.number().int().nonnegative(),
    type: z.literal("asset"),
    first_seen_offset: z.number().int().nonnegative(),
    projection: assetContextProjectionSchema,
  })
  .strict();

const sceneCardDerivedReferenceSchema = z
  .object({
    mention_id: decimalIdSchema,
    mention_seq: z.number().int().nonnegative(),
    type: z.literal("scene_card"),
    first_seen_offset: z.number().int().nonnegative(),
    projection: sceneCardContextProjectionSchema,
  })
  .strict();

export const derivedReferenceSchema = z.discriminatedUnion("type", [
  assetDerivedReferenceSchema,
  sceneCardDerivedReferenceSchema,
]);

export const frozenGenerationParametersSchema = z
  .object({
    capability_type: z.enum(["image", "video"]),
    model_id: z.string().min(1),
    provider_id: z.string().min(1),
    size: z.string().min(1),
    aspect_ratio: z.string().min(1),
    format: z.string().min(1).nullable(),
    duration: z.number().int().positive().nullable(),
    count: z.number().int().positive(),
  })
  .strict();

export const providerPromptAssetSchema = z.discriminatedUnion("type", [
  z
    .object({
      mention_id: decimalIdSchema,
      type: z.literal("asset"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
      projection: assetContextProjectionSchema,
    })
    .strict(),
  z
    .object({
      mention_id: decimalIdSchema,
      type: z.literal("scene_card"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
      projection: sceneCardContextProjectionSchema,
    })
    .strict(),
  z
    .object({
      slot_id: decimalIdSchema,
      type: z.literal("storyboard_frame"),
      role: z.enum(["first_frame", "last_frame", "reference"]),
    })
    .strict(),
]);

export type CapabilitySnapshotVersion = z.infer<
  typeof capabilitySnapshotVersionSchema
>;
export type DerivedReference = z.infer<typeof derivedReferenceSchema>;
export type FrozenGenerationParameters = z.infer<
  typeof frozenGenerationParametersSchema
>;
export type ProviderPromptAsset = z.infer<typeof providerPromptAssetSchema>;
