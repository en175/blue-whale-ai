import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_MAX_REFERENCE_IMAGE_PIXELS,
  DEFAULT_MAX_REFERENCE_IMAGE_RATIO,
} from "../model-capability/constants.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import {
  getModelCapabilityList,
  setModelCapabilityList,
} from "./model-capability-cache.js";


export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;

export const DEFAULT_IMAGE_REFERENCE_MAX = 10;

export const DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1;

export interface ModelSizeOption {
  id: string;
  label: string;
  api_value: string;
}

export interface ModelAspectRatioOption {
  id: string;
  label: string;
}

export interface ModelDurationRange {
  min: number;
  max: number;
  step: number;
}

export interface ModelFeatures {
  reference_image: boolean;
  watermark: boolean;
  quantity_max: number;
  sequential_image_generation: boolean;
  stream: boolean;
  tools: boolean;
  first_frame: boolean;
  last_frame: boolean;
  first_last_frame: boolean;
  audio: boolean;
  i2i_model_name: string | null;
  max_prompt_length: number | null;
  video_reference: boolean;
  video_reference_max: number;
  audio_reference: boolean;
  audio_reference_max: number;
  image_reference_max: number;
  max_reference_image_pixels: number;
  max_reference_image_ratio: number;
  max_reference_duration_sec: number | null;
  task_types: Record<string, unknown> | null;
  video_dimensions: Record<string, string> | null;
  sample_mode: boolean;
  omni_reference_task_type: boolean;
}

export interface ModelCapabilityView {
  model_id: string;
  provider_id: string;
  model_label: string;
  icon: string | null;
  supported_sizes: ModelSizeOption[];
  supported_aspect_ratios: ModelAspectRatioOption[];
  supported_formats: string[];
  supported_durations: ModelDurationRange | null;
  default_size: string;
  default_format: string | null;
  default_aspect_ratio: string;
  default_duration: number | null;
  features: ModelFeatures;
  pricing: unknown;
  channel: string | null;
  request_mapping: unknown;
  is_default: boolean;
  version: number;
  digest: string;
}

export function serializePricingRule(
  capability: Pick<ModelCapabilityView, "pricing"> | undefined,
): string | undefined {
  const pricing = capability?.pricing;
  if (pricing === undefined || pricing === null) return undefined;
  try {
    return JSON.stringify(pricing);
  } catch {
    return undefined;
  }
}

export interface ModelCapabilityRepo {
  listEnabledByType(capabilityType: string): Promise<ModelCapabilityView[]>;
}

type SizeJson = {
  id?: string;
  label?: string;
  apiValue?: string;
  api_value?: string;
};

type FeaturesJson = {
  referenceImage?: boolean;
  reference_image?: boolean;
  watermark?: boolean;
  quantityMax?: number;
  quantity_max?: number;
  sequentialImageGeneration?: boolean;
  sequential_image_generation?: boolean;
  stream?: boolean;
  tools?: boolean;
  firstFrame?: boolean;
  first_frame?: boolean;
  lastFrame?: boolean;
  last_frame?: boolean;
  firstLastFrame?: boolean;
  first_last_frame?: boolean;
  audio?: boolean;
  i2iModelName?: unknown;
  i2i_model_name?: unknown;
  maxPromptLength?: unknown;
  max_prompt_length?: unknown;
  videoReference?: boolean;
  video_reference?: boolean;
  videoReferenceMax?: number;
  video_reference_max?: number;
  audioReference?: boolean;
  audio_reference?: boolean;
  audioReferenceMax?: number;
  audio_reference_max?: number;
  imageReferenceMax?: number;
  image_reference_max?: number;
  maxReferenceImagePixels?: unknown;
  max_reference_image_pixels?: unknown;
  maxReferenceImageRatio?: unknown;
  max_reference_image_ratio?: unknown;
  maxReferenceDurationSec?: unknown;
  max_reference_duration_sec?: unknown;
  taskTypes?: unknown;
  task_types?: unknown;
  videoDimensions?: unknown;
  video_dimensions?: unknown;
  sampleMode?: boolean;
  sample_mode?: boolean;
  omniReferenceTaskType?: boolean;
  omni_reference_task_type?: boolean;
};

type DurationRangeJson = {
  min?: unknown;
  max?: unknown;
  step?: unknown;
};

function toSizes(json: unknown): ModelSizeOption[] {
  if (!Array.isArray(json)) return [];
  return json.map((o: SizeJson) => ({
    id: o.id ?? "",
    label: o.label ?? "",
    api_value: o.apiValue ?? o.api_value ?? "",
  }));
}

function pickAlias(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function pickPositiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

function pickNonNegativeInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function pickPositiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function pickTaskTypes(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickDimensions(v: unknown): Record<string, string> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.length === 0) continue;
    if (typeof val !== "string" || val.length === 0) continue;
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function toFeatures(json: unknown, capabilityType?: string): ModelFeatures {
  const f = (json ?? {}) as FeaturesJson;
  return {
    reference_image: f.referenceImage === true || f.reference_image === true,
    watermark: f.watermark === true,
    quantity_max: f.quantityMax ?? f.quantity_max ?? 1,
    sequential_image_generation:
      f.sequentialImageGeneration === true ||
      f.sequential_image_generation === true,
    stream: f.stream === true,
    tools: f.tools === true,
    first_frame: f.firstFrame === true || f.first_frame === true,
    last_frame: f.lastFrame === true || f.last_frame === true,
    first_last_frame: f.firstLastFrame === true || f.first_last_frame === true,
    audio: f.audio === true,
    i2i_model_name: pickAlias(f.i2iModelName ?? f.i2i_model_name),
    max_prompt_length: pickPositiveInt(f.maxPromptLength ?? f.max_prompt_length),
    video_reference: f.videoReference === true || f.video_reference === true,
    video_reference_max:
      pickNonNegativeInt(f.videoReferenceMax ?? f.video_reference_max) ??
      DEFAULT_VIDEO_REFERENCE_MAX,
    audio_reference: f.audioReference === true || f.audio_reference === true,
    audio_reference_max:
      pickNonNegativeInt(f.audioReferenceMax ?? f.audio_reference_max) ??
      DEFAULT_AUDIO_REFERENCE_MAX,
    image_reference_max:
      pickNonNegativeInt(f.imageReferenceMax ?? f.image_reference_max) ??
      (capabilityType === "audio"
        ? DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO
        : DEFAULT_IMAGE_REFERENCE_MAX),
    max_reference_image_pixels:
      pickPositiveInt(f.maxReferenceImagePixels ?? f.max_reference_image_pixels) ??
      DEFAULT_MAX_REFERENCE_IMAGE_PIXELS,
    max_reference_image_ratio:
      pickPositiveNumber(f.maxReferenceImageRatio ?? f.max_reference_image_ratio) ??
      DEFAULT_MAX_REFERENCE_IMAGE_RATIO,
    max_reference_duration_sec: pickPositiveNumber(
      f.maxReferenceDurationSec ?? f.max_reference_duration_sec,
    ),
    task_types: pickTaskTypes(f.taskTypes ?? f.task_types),
    video_dimensions: pickDimensions(f.videoDimensions ?? f.video_dimensions),
    sample_mode: f.sampleMode === true || f.sample_mode === true,
    omni_reference_task_type:
      f.omniReferenceTaskType === true || f.omni_reference_task_type === true,
  };
}

function asStringArray(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((v): v is string => typeof v === "string") : [];
}

function toAspectRatios(json: unknown): ModelAspectRatioOption[] {
  if (!Array.isArray(json)) return [];
  const out: ModelAspectRatioOption[] = [];
  for (const item of json) {
    if (typeof item === "string") {
      if (item.length > 0) out.push({ id: item, label: item });
      continue;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as { id?: unknown; label?: unknown };
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    const label = typeof o.label === "string" && o.label.trim().length > 0 ? o.label : o.id;
    out.push({ id: o.id, label });
  }
  return out;
}

function toDurationRange(json: unknown): ModelDurationRange | null {
  let min: unknown;
  let max: unknown;
  let step: unknown;
  if (Array.isArray(json)) {
    min = json[0];
    max = json[1];
    step = json[2] ?? 1;
  } else {
    const d = (json ?? {}) as DurationRangeJson;
    min = d.min;
    max = d.max;
    step = d.step ?? 1;
  }
  const minN = Number(min);
  const maxN = Number(max);
  const stepN = Number(step);
  if (!Number.isFinite(minN) || !Number.isFinite(maxN) || !Number.isFinite(stepN)) {
    return null;
  }
  if (stepN <= 0 || maxN < minN) return null;
  return { min: minN, max: maxN, step: stepN };
}

export function createModelCapabilityRepo(prisma: PrismaClient): ModelCapabilityRepo {
  return {
    async listEnabledByType(capabilityType) {
      const cached = await getModelCapabilityList(capabilityType);
      if (cached) {
        return cached.map((view) => ({
          ...view,
          supported_aspect_ratios: toAspectRatios(view.supported_aspect_ratios),
        }));
      }
      const rows = await prisma.catalog_models.findMany({
        where: { capability_type: capabilityType, enabled: true, is_delete: false },
        orderBy: { sort_order: "asc" },
      });
      const views = rows.map((cap) => ({
        model_id: cap.model_id,
        provider_id: cap.provider_id,
        model_label: cap.model_label,
        icon: cap.icon,
        supported_sizes: toSizes(cap.supported_sizes),
        supported_aspect_ratios: toAspectRatios(cap.supported_aspect_ratios),
        supported_formats: asStringArray(cap.supported_formats),
        supported_durations: toDurationRange(cap.supported_durations),
        default_size: cap.default_size,
        default_format: cap.default_format,
        default_aspect_ratio: cap.default_aspect_ratio,
        default_duration: cap.default_duration,
        features: toFeatures(cap.features, capabilityType),
        channel:
          typeof cap.channel === "string" && cap.channel.length > 0
            ? cap.channel
            : null,
        request_mapping: cap.request_mapping ?? null,
        pricing: cap.pricing ?? null,
        is_default: cap.is_default === true,
        version: cap.version,
        digest: capabilityDigestFromModelCapability(cap),
      }));
      await setModelCapabilityList(capabilityType, views);
      return views;
    },
  };
}
