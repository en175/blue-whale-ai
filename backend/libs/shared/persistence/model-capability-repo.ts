import type { PrismaClient } from "@prisma/client";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";

/** 模型能力只读 repo（Prisma-backed），复用 generation_model_capability 表。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities：查启用项 + DTO 整形。
 *  wire 字段 snake_case（Jackson SNAKE_CASE）。 */

/** 参考图数量缺省上限：与网关（blue-whale-api maxImageEditImages=10）/ 火山方舟
 *  Seedream 4.0/5.0（10 张复合编辑）对齐（IKA72G）。后端创建校验与 generation worker
 *  共用此常量兜底；模型能力行显式配置 features.max_reference_images 时以其为准。 */
export const DEFAULT_MAX_REFERENCE_IMAGES = 10;

/** 参考素材分类上限缺省（ADR-0086）：与旧前端/服务端硬编码对齐，模型能力行未配置时兜底。
 *  - 视频生成普通参考中视频素材上限 3（旧 MAX_VIDEO_REFS）
 *  - 音频生成中音频参考上限 3 / 图片参考上限 1（旧 validateAudioReferences 硬编码）
 *  能力行显式配置 features.video_reference_max / audio_reference_max / image_reference_max 时以其为准。 */
export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;
export const DEFAULT_IMAGE_REFERENCE_MAX = 1;

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
  /** 该视频模型是否允许生成带音频（video features.audio）。图片恒 false。
   *  IKG0LP：从「视频带音轨」事实描述升级为**许可位**——为 true 时前端显示「是否带音频」开关，
   *  用户选择才冻结进 job 快照；false/未配则不出开关、出站不下发 generate_audio。
   *  契约见 docs/specs/2026-09-15-ikg0lp-video-generate-audio-contract.md。
   *  ⚠️ 新增模型必须确认真实支持情况：Seedance 1.0 系（Pro / Pro Fast / Lite）不支持该参数。 */
  audio: boolean;
  /** 图生图上游模型名别名（ADR-0085）：有参考图时 worker 出站改用它；null=不分流。 */
  i2i_model_name: string | null;
  /** 该档 raw prompt 上限（ADR-0085）；null=回落按类型的硬缺省。 */
  max_prompt_length: number | null;
  /** 视频生成是否接受视频素材作普通参考（ADR-0086）。替代旧 supportsVideoReferenceModel seedance 前缀特判。 */
  video_reference: boolean;
  /** 普通参考中视频素材上限（ADR-0086）；缺省 DEFAULT_VIDEO_REFERENCE_MAX。 */
  video_reference_max: number;
  /** 视频生成是否接受音频素材作参考（ADR-0086；Seedance 2.0 关 / 2.5 开）。 */
  audio_reference: boolean;
  /** 音频生成中音频参考上限（ADR-0086）；缺省 DEFAULT_AUDIO_REFERENCE_MAX。 */
  audio_reference_max: number;
  /** 音频生成中图片参考上限（ADR-0086）；缺省 DEFAULT_IMAGE_REFERENCE_MAX。 */
  image_reference_max: number;
  /** 输入参考素材总时长上限（秒，ADR-0086；视频/音频参考。2.0=15 / 2.5=30；null=不限）。 */
  max_reference_duration_sec: number | null;
  /** 按任务类型的比例/时长约束（ADR-0086）：default / first_frame / first_last_frame / edit / prolong。
   *  ⚠️ 修订（IKG4UR）：**`allowed_durations` 已退役**——官方时长口径是连续区间，写成枚举会让
   *  滑杆给得出的值提交必被 400。时长唯一来源为基础行 `supported_durations`（对象 `{min,max,step}`）。
   *  读侧分支暂留未删（待 `-1` 接入时一并处置），但**不要再往数据里配它**。见 ADR-0086 修订段。
   *  当前只有 `allowed_ratios` 在用。 */
  task_types: Record<string, unknown> | null;
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
  /** 生成渠道解析器（seedream / gpt / banana）。消费端列表会剥掉。 */
  channel_parser: string;
  /** GPT 交叉格 / banana 一维映射。消费端列表会剥掉。 */
  request_mapping: unknown;
  /** 该 capability_type 的显式默认模型（IKE0VX）。
   *  在它之前，「默认用哪个」是 sort_order 的副作用：调一次排序就换掉了所有新会话的
   *  默认模型，而那个字段在管理后台叫「排序」。消费端读这一位，读不到才退回列表第一条。
   *  **不进 digest**——digest 的字段集是冻结快照的比对口径，多一位会让历史快照全部误判漂移。 */
  is_default: boolean;
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
  i2iModelName?: unknown;
  i2i_model_name?: unknown;
  maxPromptLength?: unknown;
  max_prompt_length?: unknown;
  videoReference?: boolean;
  video_reference?: boolean;
  videoReferenceMax?: number;
  video_reference_max?: number;
  audioReference?: boolean;
  audio_reference?: boolean;
  audioReferenceMax?: number;
  audio_reference_max?: number;
  imageReferenceMax?: number;
  image_reference_max?: number;
  maxReferenceDurationSec?: unknown;
  max_reference_duration_sec?: unknown;
  taskTypes?: unknown;
  task_types?: unknown;
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

/** ADR-0085 读侧宽容：脏值（非非空串 / 非正整数）一律降级 null = 未配置，
 *  写侧闸门在 constants.ts featuresFieldErr 拒绝。 */
function pickAlias(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function pickPositiveInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/** ADR-0086 读侧：非负整数（含 0）——参考上限允许显式 0（禁用该类型素材）。 */
function pickNonNegativeInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** ADR-0086 读侧：正数（秒）——参考素材总时长上限。 */
function pickPositiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** ADR-0086 读侧：task_types 为 JSON 对象（宽容降级空对象）；写侧由闸门校验。 */
function pickTaskTypes(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
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
    i2i_model_name: pickAlias(f.i2iModelName ?? f.i2i_model_name),
    max_prompt_length: pickPositiveInt(f.maxPromptLength ?? f.max_prompt_length),
    video_reference: f.videoReference === true || f.video_reference === true,
    video_reference_max:
      pickNonNegativeInt(f.videoReferenceMax ?? f.video_reference_max) ??
      DEFAULT_VIDEO_REFERENCE_MAX,
    audio_reference: f.audioReference === true || f.audio_reference === true,
    audio_reference_max:
      pickNonNegativeInt(f.audioReferenceMax ?? f.audio_reference_max) ??
      DEFAULT_AUDIO_REFERENCE_MAX,
    image_reference_max:
      pickNonNegativeInt(f.imageReferenceMax ?? f.image_reference_max) ??
      DEFAULT_IMAGE_REFERENCE_MAX,
    max_reference_duration_sec: pickPositiveNumber(
      f.maxReferenceDurationSec ?? f.max_reference_duration_sec,
    ),
    task_types: pickTaskTypes(f.taskTypes ?? f.task_types),
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
        channel_parser:
          typeof cap.channel_parser === "string" && cap.channel_parser.length > 0
            ? cap.channel_parser
            : "seedream",
        request_mapping: cap.request_mapping ?? null,
        is_default: cap.is_default === true,
        version: cap.version,
        digest: capabilityDigestFromModelCapability(cap),
      }));
    },
  };
}
