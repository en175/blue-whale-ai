/* ============================================
 * 高清放大（IKGM9F/IKGLZV）：图片卡「高清放大」入口的身份标记与来源边常量。
 * IKGM9F 做入口建卡；IKGM9O 在此补充面板参数域（尺寸预检/置灰档冻结/默认档回退）。
 * 枚举、能力矩阵、默认值与提交校验 schema 直接复用 backend/libs/contracts/image-enhance.ts
 * （web 经 @lib alias 引入契约，先例见 CanvasPage 的 @lib/contracts/prompt-target）。
 * ============================================ */
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

/** 高清来源边标记（写在 edge.data.origin）：这条边表达「高清卡由该图放大而来」，
 *  是来源记录而非生成参考输入——图片参考推导（imageMediaRefsOf）会跳过带此标记的边，
 *  源图不占参考位、不参与 @ 编号与媒体索引（口径同 mediaExtract 来源边）。 */
export const IMAGE_ENHANCE_EDGE_ORIGIN = 'image-enhance';

/** 高清卡与源卡的横向间距（沿用既有「节点宽 + 60」口径） */
const IMAGE_ENHANCE_NODE_GAP = 60;

/** 高清身份标记（node.data.imageEnhance）：高清卡的「重新编辑」据此分流到高清放大面板（IKGM9O）。 */
export interface ImageEnhanceIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id 与面板回填共用 */
  sourceAssetId?: string;
  /** 上次提交参数（IKGM9O 面板提交时写入并回填；键名以 IKGM8U 契约为准，此处只预留形状） */
  lastParams?: Record<string, unknown>;
}

/** 高清草稿卡出生位：源卡右侧让开一格（按源卡实际内容宽，口径同 mediaExtract 占位节点）。 */
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

/* ============ 面板参数域（IKGM9O） ============ */

/** 面板参数（契约六键中的四个业务键；source_asset_id / target_node_id 由提交时补齐）。
 *  键名与形态同 ImageEnhanceInput，lastParams 持久化与此同构。 */
export interface ImageEnhancePanelParams {
  version_tier: ImageEnhanceVersionTier;
  multiple: (typeof IMAGE_ENHANCE_MULTIPLES)[number];
  generative_enhance_mode: ImageEnhanceMode;
  enable_correct_color: boolean;
}

/** 版本档展示名（仅 UI，不落库不进任务——口径同契约注释）。 */
export const IMAGE_ENHANCE_TIER_LABELS: Record<ImageEnhanceVersionTier, string> = {
  lite: 'Lite',
  pro: 'Pro',
  max: 'Max',
};

/** 增强策略展示名。 */
export const IMAGE_ENHANCE_MODE_LABELS: Record<ImageEnhancePanelParams['generative_enhance_mode'], string> = {
  generative_first: '生成度优先',
  fidelity_first: '保真度优先',
};

/** 源图尺寸门槛预检（IKGM9O）：返回该档不可用原因，null 为可用。
 *  门槛数值与判定在契约 imageEnhanceTierSizeGate 单处定义（backend 服务端复核同源引用，
 *  规格 docs/specs/2026-09-17-image-upscale-mediakit.md「Implementation Decisions 前端」）；
 *  前端只是体验层，服务端按 asset 权威尺寸同口径复核。 */
export function imageEnhanceTierGateReason(
  tier: ImageEnhanceVersionTier,
  width: number | undefined,
  height: number | undefined,
): string | null {
  // 尺寸缺失（存量图宽高 null）不拦：与服务端同口径放行交供应商拒（IKGM99 契约）
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return imageEnhanceTierSizeGate(tier, width, height);
}

/** 三档可用性（打开面板时对源图尺寸快照预检一次）。 */
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

/** 默认档不可用时自动落到第一个可用档（lite→pro→max 顺序）；三档全不可用返回 null（禁发）。 */
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

/** 置灰档冻结口径（服务端硬校验对齐，契约 §14.2）：非 Max 档提交 enable_correct_color=false；
 *  Lite 档提交 generative_enhance_mode='generative_first'（默认占位值，显式激活值会被服务端拒）。 */
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

/** 组装契约六键 input 并按 zod schema 校验（提交前最后一道本地防线，同源契约）。 */
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

/** 从 lastParams（契约六键形态）恢复面板参数；缺键/非法值回落契约默认值。 */
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
