import {
  IMAGE_ENHANCE_DEFAULTS,
  IMAGE_ENHANCE_INPUT_KEYS,
  IMAGE_ENHANCE_MULTIPLES,
  IMAGE_ENHANCE_TIER_CAPABILITY,
  IMAGE_ENHANCE_VERSION_TIERS,
  imageEnhanceInputSchema,
  imageEnhanceTierSizeGate,
  type ImageEnhanceInput,
  type ImageEnhanceMode,
  type ImageEnhanceVersionTier,
} from '@lib/contracts/image-enhance';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

export const IMAGE_ENHANCE_EDGE_ORIGIN = 'image-enhance';

const IMAGE_ENHANCE_NODE_GAP = 60;

export interface ImageEnhanceIdentity {
  sourceAssetId?: string;
  lastParams?: Record<string, unknown>;
}

export function imageEnhanceDraftPosition(source: {
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
}): { x: number; y: number } {
  const x = Number(source.position?.x ?? 0);
  const y = Number(source.position?.y ?? 0);
  const data = source.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    x: Math.round(left + box.width + IMAGE_ENHANCE_NODE_GAP),
    y: Math.round(top),
  };
}


export interface ImageEnhancePanelParams {
  version_tier: ImageEnhanceVersionTier;
  multiple: (typeof IMAGE_ENHANCE_MULTIPLES)[number];
  generative_enhance_mode: ImageEnhanceMode;
  enable_correct_color: boolean;
}

export const IMAGE_ENHANCE_TIER_LABELS: Record<ImageEnhanceVersionTier, string> = {
  lite: 'Lite',
  pro: 'Pro',
  max: 'Max',
};

export const IMAGE_ENHANCE_MODE_LABELS: Record<ImageEnhancePanelParams['generative_enhance_mode'], string> = {
  generative_first: '生成度优先',
  fidelity_first: '保真度优先',
};

export function imageEnhanceTierGateReason(
  tier: ImageEnhanceVersionTier,
  width: number | undefined,
  height: number | undefined,
): string | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return imageEnhanceTierSizeGate(tier, width, height);
}

export function imageEnhanceTierAvailability(
  width: number | undefined,
  height: number | undefined,
): Array<{ tier: ImageEnhanceVersionTier; label: string; disabledReason: string | null }> {
  return IMAGE_ENHANCE_VERSION_TIERS.map((tier) => ({
    tier,
    label: IMAGE_ENHANCE_TIER_LABELS[tier],
    disabledReason: imageEnhanceTierGateReason(tier, width, height),
  }));
}

export function pickImageEnhanceTier(
  preferred: ImageEnhanceVersionTier,
  width: number | undefined,
  height: number | undefined,
): ImageEnhanceVersionTier | null {
  if (!imageEnhanceTierGateReason(preferred, width, height)) return preferred;
  return (
    IMAGE_ENHANCE_VERSION_TIERS.find(
      (tier) => !imageEnhanceTierGateReason(tier, width, height),
    ) ?? null
  );
}

export function freezeImageEnhanceParams(params: ImageEnhancePanelParams): ImageEnhancePanelParams {
  const capability = IMAGE_ENHANCE_TIER_CAPABILITY[params.version_tier];
  return {
    version_tier: params.version_tier,
    multiple: params.multiple,
    generative_enhance_mode: capability.enhanceMode
      ? params.generative_enhance_mode
      : IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode,
    enable_correct_color: capability.correctColor ? params.enable_correct_color : false,
  };
}

export function buildImageEnhanceInput(
  sourceAssetId: string,
  targetNodeId: string,
  params: ImageEnhancePanelParams,
): ImageEnhanceInput | null {
  const frozen = freezeImageEnhanceParams(params);
  const input = {
    [IMAGE_ENHANCE_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [IMAGE_ENHANCE_INPUT_KEYS.targetNodeId]: targetNodeId,
    [IMAGE_ENHANCE_INPUT_KEYS.versionTier]: frozen.version_tier,
    [IMAGE_ENHANCE_INPUT_KEYS.multiple]: frozen.multiple,
    [IMAGE_ENHANCE_INPUT_KEYS.generativeEnhanceMode]: frozen.generative_enhance_mode,
    [IMAGE_ENHANCE_INPUT_KEYS.enableCorrectColor]: frozen.enable_correct_color,
  };
  return imageEnhanceInputSchema.safeParse(input).success ? (input as ImageEnhanceInput) : null;
}

export function restoreImageEnhanceParams(
  lastParams: Record<string, unknown> | undefined,
): ImageEnhancePanelParams {
  const tier = lastParams?.[IMAGE_ENHANCE_INPUT_KEYS.versionTier];
  const multiple = lastParams?.[IMAGE_ENHANCE_INPUT_KEYS.multiple];
  const mode = lastParams?.[IMAGE_ENHANCE_INPUT_KEYS.generativeEnhanceMode];
  const color = lastParams?.[IMAGE_ENHANCE_INPUT_KEYS.enableCorrectColor];
  return {
    version_tier: IMAGE_ENHANCE_VERSION_TIERS.includes(tier as ImageEnhanceVersionTier)
      ? (tier as ImageEnhanceVersionTier)
      : IMAGE_ENHANCE_DEFAULTS.versionTier,
    multiple: (IMAGE_ENHANCE_MULTIPLES as readonly number[]).includes(multiple as number)
      ? (multiple as ImageEnhancePanelParams['multiple'])
      : IMAGE_ENHANCE_DEFAULTS.multiple,
    generative_enhance_mode:
      mode === 'fidelity_first' || mode === 'generative_first'
        ? mode
        : IMAGE_ENHANCE_DEFAULTS.generativeEnhanceMode,
    enable_correct_color: typeof color === 'boolean' ? color : IMAGE_ENHANCE_DEFAULTS.enableCorrectColor,
  };
}
