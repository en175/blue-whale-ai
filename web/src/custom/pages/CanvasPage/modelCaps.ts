import { createContext, useContext } from 'react';
import type { GenerationModel } from '@/custom/api/generation';
import {
  audioReferenceMaxOf,
  imageReferenceMaxOf,
  maxReferenceDurationSecOf,
  supportsAudioReferenceOf,
  supportsVideoReferenceOf,
  videoReferenceMaxOf,
  UNRESOLVED_IMAGE_REFERENCE_LIMIT,
} from '@/custom/utils/model-reference-limits';
import type { VideoRefCapabilities } from './videoMediaRefs';

export function videoRefCapsOfModel(model?: GenerationModel | null): VideoRefCapabilities | null {
  if (!model) return null;
  const f = model.features;
  return {
    firstFrame: f.first_frame,
    lastFrame: f.last_frame,
    firstLastFrame: f.first_last_frame,
    referenceImage: f.reference_image,
    videoReference: supportsVideoReferenceOf(f),
    audioReference: supportsAudioReferenceOf(f),
    videoReferenceMax: videoReferenceMaxOf(f),
    audioReferenceMax: audioReferenceMaxOf(f),
    imageMax: imageReferenceMaxOf(f),
    maxReferenceDurationSec: maxReferenceDurationSecOf(f),
  };
}

const AssetImageRefLimitContext = createContext(UNRESOLVED_IMAGE_REFERENCE_LIMIT);

export const AssetImageRefLimitProvider = AssetImageRefLimitContext.Provider;

export function useAssetImageRefLimit(): number {
  return useContext(AssetImageRefLimitContext);
}
