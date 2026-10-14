import { useEffect, useRef, useState } from 'react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { imageReferenceMaxOf } from '@/utils/model-reference-limits';

export function useCanvasGenerationModels() {
  const [videoModels, setVideoModels] = useState<GenerationModel[]>([]);
  const [imageModels, setImageModels] = useState<GenerationModel[]>([]);
  const videoModelsRef = useRef<GenerationModel[]>([]);
  videoModelsRef.current = videoModels;
  const imageModelsRef = useRef<GenerationModel[]>([]);
  imageModelsRef.current = imageModels;
  useEffect(() => {
    fetchGenerationModels('video').then(setVideoModels).catch(() => undefined);
    fetchGenerationModels('image').then(setImageModels).catch(() => undefined);
  }, []);
  const assetImageRefMax = imageReferenceMaxOf(
    (imageModels.find((m) => m.is_default) ?? imageModels[0])?.features,
  );
  return { videoModels, imageModels, videoModelsRef, imageModelsRef, assetImageRefMax };
}
