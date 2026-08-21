import type { PrismaClient } from "@prisma/client";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";

/** 模型能力只读 repo（Prisma-backed），复用 generation_model_capability 表。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities：查启用项 + DTO 整形。
 *  wire 字段 snake_case（Jackson SNAKE_CASE）。 */

/** 参考图数量缺省上限：与网关（blue-whale-api maxImageEditImages=10）/ 火山方舟
 *  Seedream 4.0/5.0（10 张复合编辑）对齐（IKA72G）。后端创建校验与 generation worker
 *  共用此常量兜底；模型能力行显式配置 features.max_reference_images 时以其为准。 */
export const DEFAULT_MAX_REFERENCE_IMAGES = 10;

export interface ModelSizeOption {
  id: string;
  label: string;
  api_value: string;
  width: number | null;
  height: number | null;
}

/** 视频时长档（DB supported_durations JSON：{min,max,step}）。图片模型为 null。 */
export interface ModelDurationRange {
  min: number;
  max: number;
  step: number;
}

export interface ModelFeatures {
  reference_image: boolean;
  max_reference_images: number;
  watermark: boolean;
  quantity_max: number;
  sequential_image_generation: boolean;
  stream: boolean;
  tools: boolean;
  /** 视频首帧引用（video features.first_frame）。图片恒 false。 */
  first_frame: boolean;
  /** 视频尾帧引用（video features.last_frame）。图片恒 false。 */
  last_frame: boolean;
  /** 视频首尾帧引用（video features.first_last_frame）。图片恒 false。 */
  first_last_frame: boolean;
  /** 视频带音频（video features.audio）。图片恒 false。 */
  audio: boolean;
}

export interface ModelCapabilityView {
  model_id: string;
  provider_id: string;
  model_label: string;
  icon: string | null;
  supported_sizes: ModelSizeOption[];
  supported_aspect_ratios: string[];
  supported_formats: string[];
  supported_durations: ModelDurationRange | null;
  default_size: string;
  default_format: string | null;
  default_aspect_ratio: string;
  default_duration: number | null;
  features: ModelFeatures;
  /** 乐观锁版本（DB version 列）；对应冻结快照的 row_version，用于预判能力漂移。 */
  version: number;
  /** 能力内容摘要（sha256，运行时算，不入库）；与冻结快照 digest 同源比对。
   *  输入字段集固定为 8 个参数字段，不含 features——改字段集会让历史快照全部误判漂移。 */
  digest: string;
}

export interface ModelCapabilityRepo {
  listEnabledByType(capabilityType: string): Promise<ModelCapabilityView[]>;
}

type SizeJson = {
  id?: string;
  label?: string;
  apiValue?: string;
  api_value?: string;
  width?: number;
  height?: number;
};

type FeaturesJson = {
  referenceImage?: boolean;
  reference_image?: boolean;
  maxReferenceImages?: number;
  max_reference_images?: number;
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
    width: o.width ?? null,
    height: o.height ?? null,
  }));
}

function toFeatures(json: unknown): ModelFeatures {
  const f = (json ?? {}) as FeaturesJson;
  return {
    reference_image: f.referenceImage === true || f.reference_image === true,
    // IK6PA5：缺省不能兜底 0——前端 atReferenceLimit = referenceCount >= max_reference_images
    // 在 0 上限时恒 true，上传入口被静默禁用。
    // IKA72G：缺省从 4 上调为 10，与网关/ARK 多图上限一致（后端创建校验/worker 同源）。
    max_reference_images:
      f.maxReferenceImages ?? f.max_reference_images ?? DEFAULT_MAX_REFERENCE_IMAGES,
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
  };
}

function asStringArray(json: unknown): string[] {
  return Array.isArray(json) ? json.filter((v): v is string => typeof v === "string") : [];
}

/** 解析 supported_durations JSON，兼容两种形态并统一归一为 {min,max,step}：
 *  - 数组 [min, max] / [min, max, step] —— seed 数据与管理端编辑（constants.ts 校验为 numberArray）；
 *  - 对象 {min,max,step} —— 历史消费端契约。
 *  非法或缺省返回 null（图片模型无时长）。 */
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
      const rows = await prisma.generation_model_capability.findMany({
        where: { capability_type: capabilityType, enabled: true, is_delete: false },
        orderBy: { sort_order: "asc" },
      });
      return rows.map((cap) => ({
        model_id: cap.model_id,
        provider_id: cap.provider_id,
        model_label: cap.model_label,
        icon: cap.icon,
        supported_sizes: toSizes(cap.supported_sizes),
        supported_aspect_ratios: asStringArray(cap.supported_aspect_ratios),
        supported_formats: asStringArray(cap.supported_formats),
        supported_durations: toDurationRange(cap.supported_durations),
        default_size: cap.default_size,
        default_format: cap.default_format,
        default_aspect_ratio: cap.default_aspect_ratio,
        default_duration: cap.default_duration,
        features: toFeatures(cap.features),
        version: cap.version,
        digest: capabilityDigestFromModelCapability(cap),
      }));
    },
  };
}
