import { apiRequest } from '@/shared/api/http';
import { type ModelCapability } from '@/custom/enums';

export interface AspectRatioOption {
  id: string;
  label: string;
}

export interface ModelSize {
  id: string;
  label: string;
  available_aspect_ratios?: AspectRatioOption[];
  api_value?: string;
  width?: number | null;
  height?: number | null;
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
  max_prompt_length?: number | null;
  video_reference?: boolean;
  video_reference_max?: number;
  audio_reference?: boolean;
  audio_reference_max?: number;
  image_reference_max?: number;
  max_reference_duration_sec?: number | null;
  task_types?: Record<string, unknown> | null;
  sample_mode?: boolean;
}

export interface GenerationModel {
  model_id: string;
  provider_id: string;
  model_label: string;
  icon: string | null;
  supported_sizes: ModelSize[];
  supported_aspect_ratios: AspectRatioOption[];
  supported_formats: string[];
  supported_durations: { min: number; max: number; step: number } | null;
  default_size: string | null;
  default_format: string | null;
  default_aspect_ratio: string | null;
  default_duration: number | null;
  features: ModelFeatures;
  is_default: boolean;
  version: number;
  digest: string;
}

const modelCache = new Map<string, Promise<GenerationModel[]>>();

export function fetchGenerationModels(capability: ModelCapability) {
  let pending = modelCache.get(capability);
  if (!pending) {
    pending = apiRequest<GenerationModel[]>(
      `/api/generation/models?capability=${capability}`
    ).catch((e) => {
      modelCache.delete(capability);
      throw e;
    });
    modelCache.set(capability, pending);
  }
  return pending;
}
