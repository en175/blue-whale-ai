/* ============================================
 * generation 接口：模型能力列表
 * ============================================ */
import { apiRequest } from './http';

/** 模型能力类型 */
export type ModelCapability = 'text' | 'video' | 'image';

/** 分辨率档位 */
export interface ModelSize {
  /** 档位 ID，发送请求时传此值 */
  id: string;
  /** 显示名称 */
  label: string;
  /** 传给 API 的实际分辨率值 */
  api_value: string;
  width: number | null;
  height: number | null;
}

/** 模型能力特性 */
export interface ModelFeatures {
  reference_image: boolean;
  max_reference_images: number;
  watermark: boolean;
  quantity_max: number;
  sequential_image_generation: boolean;
  stream: boolean;
  tools: boolean;
  first_frame: boolean;
  last_frame: boolean;
  first_last_frame: boolean;
  audio: boolean;
}

/** GET /api/generation/models 返回项 */
export interface GenerationModel {
  /** 模型唯一标识，生成请求 parameters.model_id 传此值 */
  model_id: string;
  provider_id: string;
  /** 模型显示名称 */
  model_label: string;
  /** 模型图标 URL，null 表示无图标 */
  icon: string | null;
  supported_sizes: ModelSize[];
  supported_aspect_ratios: string[];
  supported_formats: string[];
  /** 视频时长范围 {min,max,step}，图片模型为 null */
  supported_durations: { min: number; max: number; step: number } | null;
  default_size: string | null;
  default_format: string | null;
  default_aspect_ratio: string | null;
  default_duration: number | null;
  features: ModelFeatures;
  /** 乐观锁版本号 */
  version: number;
  /** 能力内容摘要 */
  digest: string;
}

/** 模型能力列表（按 capability 缓存：首页并发三调用/StrictMode 双挂载只发一次请求；失败释放缓存可重试） */
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
