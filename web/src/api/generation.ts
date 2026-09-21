/* ============================================
 * generation 接口：模型能力列表
 * ============================================ */
import { apiRequest } from './http';

/** 模型能力类型 */
export type ModelCapability = 'text' | 'video' | 'image' | 'audio';

/** 分辨率档位 */
export interface ModelSize {
  /** 档位 ID，发送请求时传此值 */
  id: string;
  /** 显示名称 */
  label: string;
  /** 当前尺寸下已填、可供选择的比例（消费端不返调用值） */
  available_aspect_ratios?: string[];
  /** 旧接口调用值；新契约已剥离，只作兼容回退 */
  api_value?: string;
  width?: number | null;
  height?: number | null;
}

/** 模型能力特性 */
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
  /** 每模型 prompt 上限；null/缺省 = 前端不设限。
   *  i2i_model_name 属出站调用值，后端已从消费端剥除，不在此类型。 */
  max_prompt_length?: number | null;
  /** ADR-0086：视频生成是否接受视频素材作普通参考（替代旧 seedance-2 前缀特判）。 */
  video_reference?: boolean;
  /** ADR-0086：普通参考中视频素材上限；缺省 3。 */
  video_reference_max?: number;
  /** ADR-0086：视频生成是否接受音频素材作参考（2.0 关 / 2.5 开）。 */
  audio_reference?: boolean;
  /** ADR-0086：视频 / 音频生成中的音频素材参考上限；IKHEXG 起缺省 1。 */
  audio_reference_max?: number;
  /** 图片 / 视频 / 音频三种生成共用的图参考上限；IKHEXG 起缺省 1。
   *  IKHEXG：合并了旧的 `max_reference_images`（该键已从前后端契约中移除）。 */
  image_reference_max?: number;
  /** ADR-0086：输入参考素材总时长上限（秒，视频/音频；2.0=15 / 2.5=30；null=不限）。 */
  max_reference_duration_sec?: number | null;
  /** ADR-0086：按任务类型的比例/时长约束（default/first_frame/first_last_frame/edit/prolong）。 */
  task_types?: Record<string, unknown> | null;
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
  /**
   * 该能力类型的显式默认模型（IKE0VX）。整个列表一条都没标时，消费端退回列表第一条——
   * 不能硬失败，目录空标记时界面还得能用。
   */
  is_default: boolean;
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
