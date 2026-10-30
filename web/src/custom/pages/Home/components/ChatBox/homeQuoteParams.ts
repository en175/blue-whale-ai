import type { GenerationModel } from '@/custom/api/generation';
import type { HomeQuotePayload, HomeQuoteRef } from '@/custom/api/homeQuote';
import { effectiveVideoParams, type VideoMode } from '@/custom/utils/video-modes';

export interface VideoQuoteInput {
  model: GenerationModel | undefined;
  mode: VideoMode;
  aspectRatio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
  prompt: string;
  references: HomeQuoteRef[];
}

export interface ImageQuoteInput {
  model: GenerationModel | undefined;
  size: string;
  aspectRatio: string;
  prompt: string;
  references: HomeQuoteRef[];
}

export function buildVideoQuotePayload(input: VideoQuoteInput): HomeQuotePayload | null {
  const model = input.model;
  if (!model) return null;
  const sizeEntry = model.supported_sizes.find((s) => s.id === input.resolution);
  const effective = effectiveVideoParams(model.features, input.mode, {
    aspectRatio: input.aspectRatio,
    duration: input.duration,
  });
  const prompt = input.prompt.trim();
  return {
    type: 'video',
    parameters: {
      model_id: model.model_id,
      mode: input.mode,
      aspect_ratio: effective.aspect_ratio,
      resolution: sizeEntry?.api_value ?? sizeEntry?.id ?? input.resolution,
      duration: effective.duration,
      ...(model.features.audio === true ? { generate_audio: input.generateAudio } : {}),
      ...(prompt ? { prompt } : {}),
    },
    references: input.references,
  };
}

export function buildImageQuotePayload(input: ImageQuoteInput): HomeQuotePayload | null {
  const model = input.model;
  if (!model) return null;
  const prompt = input.prompt.trim();
  return {
    type: 'image',
    parameters: {
      model_id: model.model_id,
      size: input.size,
      aspect_ratio: input.aspectRatio,
      ...(prompt ? { prompt } : {}),
    },
    references: input.references,
  };
}
