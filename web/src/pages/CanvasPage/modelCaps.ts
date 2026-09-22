/* ============================================
 * modelCaps 画布层模型能力归一（ADR-0086）：把后台能力行 GenerationModel.features 收敛为画布
 * 消费的参考上限与门控，替代画布内写死的 9/3/3、10 与 seedance-2 前缀特判。
 * 读侧纯函数与首页 / BottomDialog 同源（@/lib/model-reference-limits，与后端 toFeatures 缺省对齐）。
 * ============================================ */
import { createContext, useContext } from 'react';
import type { GenerationModel } from '@/api/generation';
import {
  audioReferenceMaxOf,
  imageReferenceMaxOf,
  supportsAudioReferenceOf,
  supportsVideoReferenceOf,
  videoReferenceMaxOf,
  UNRESOLVED_IMAGE_REFERENCE_LIMIT,
} from '@/lib/model-reference-limits';
import type { VideoRefCapabilities } from './videoMediaRefs';

/** 模型行 → 视频参考能力（与 BottomDialog 的 caps 构造同口径）。
 *  模型未解析（能力列表未加载 / 草稿卡未绑定模型）返回 null：调用方按缺省处理且**不阻断**，
 *  宁可交服务端 400 判定，也不做客户端假阴性拦截。 */
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
  };
}

/** 资产卡参考图上限（图片生成能力行的 image_reference_max）。
 *  资产卡经图片面板生成图片，故以图片能力默认模型为口径；**能力列表未加载时用不阻断的宽松
 *  兜底**（IKHBO 口径，交服务端判定），而不是能力缺省 1。 */
const AssetImageRefLimitContext = createContext(UNRESOLVED_IMAGE_REFERENCE_LIMIT);

/** 注入资产卡参考图上限（画布页按图片能力模型解析后下发；不注入时用能力缺省值） */
export const AssetImageRefLimitProvider = AssetImageRefLimitContext.Provider;

/** 资产卡内读参考图上限（含未加载兜底，不允许出现无上限） */
export function useAssetImageRefLimit(): number {
  return useContext(AssetImageRefLimitContext);
}
