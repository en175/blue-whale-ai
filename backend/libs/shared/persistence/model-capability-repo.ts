import type { PrismaClient } from "@prisma/client";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import {
  getModelCapabilityList,
  setModelCapabilityList,
} from "./model-capability-cache.js";

/** 模型能力只读 repo（Prisma-backed），复用 generation_model_capability 表。
 *  对齐 Java GenerationModelCapabilityService.listCapabilities：查启用项 + DTO 整形。
 *  wire 字段 snake_case（Jackson SNAKE_CASE）。 */

/** 参考素材上限缺省（ADR-0086 / IKHEXG）：模型能力行未配置时兜底，**各自对齐官方口径**。
 *
 *  键按**素材媒介**命名，作用域由调用点的 `kind` 决定（见 generation-runtime/reference-limits.ts）：
 *  `image_reference_max` 服务图片/视频/音频三种生成，`video_reference_max` 只服务视频生成，
 *  `audio_reference_max` 服务视频与音频生成。
 *
 *  ⚠️ `image_reference_max` 一把键服务三种生成，但**官方值按生成类型分叉**（图片/视频 10、
 *  音频 1），故拆成两个常量、由 {@link toFeatures} 按行的 capability_type 选。 */
export const DEFAULT_VIDEO_REFERENCE_MAX = 3;
export const DEFAULT_AUDIO_REFERENCE_MAX = 3;

/** 图片 / 视频生成的图参考上限缺省：与网关（`blue-whale-api` `maxImageEditImages=10`）/
 *  火山方舟 Seedream 4.0/5.0（10 张复合编辑）对齐（IKA72G，原 `max_reference_images` 的缺省；
 *  IKHEXG 合并后仍是图片/视频链路的缺省）。 */
export const DEFAULT_IMAGE_REFERENCE_MAX = 10;

/** **音频**生成的图参考上限缺省：官方音频接口只收 1 张图片参考，且音频与图片参考不可混用
 *  （旧 `validateAudioReferences` 硬编码口径；逐模型真值见
 *  docs/specs/2026-09-14-ikfjjt-model-capability-production-data.md 音频表 = 1）。
 *  IKHEXG：显式命名——此前它与 `max_reference_images` 共用「图片上限」的语义，是误判之源。 */
export const DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO = 1;

export interface ModelSizeOption {
  id: string;
  label: string;
  /** 出站档位值；IKHTVR 起恒等于 `id`（管理端不再单独编辑），读侧仍兼容库里的旧值。 */
  api_value: string;
}

/** 视频时长档（DB supported_durations JSON：{min,max,step}）。图片模型为 null。 */
export interface ModelDurationRange {
  min: number;
  max: number;
  step: number;
}

export interface ModelFeatures {
  reference_image: boolean;
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
  /** 视频生成普通参考中的视频素材上限（ADR-0086）；缺省 DEFAULT_VIDEO_REFERENCE_MAX。 */
  video_reference_max: number;
  /** 视频生成是否接受音频素材作参考（ADR-0086；Seedance 2.0 关 / 2.5 开）。 */
  audio_reference: boolean;
  /** 视频 / 音频生成中的音频素材参考上限（ADR-0086）；缺省 DEFAULT_AUDIO_REFERENCE_MAX。 */
  audio_reference_max: number;
  /** 图片 / 视频 / 音频三种生成中的图参考上限；缺省 DEFAULT_IMAGE_REFERENCE_MAX。
   *  IKHEXG：合并了旧的 `max_reference_images`（该行原写「音频生成中图片参考上限」，已不成立）。 */
  image_reference_max: number;
  /** 输入参考素材总时长上限（秒，ADR-0086；视频/音频参考。2.0=15 / 2.5=30；null=不限）。 */
  max_reference_duration_sec: number | null;
  /** 按任务类型的比例/时长约束（ADR-0086）：default / first_frame / first_last_frame / edit / prolong。
   *  ⚠️ 修订（IKG4UR）：**`allowed_durations` 已退役**——官方时长口径是连续区间，写成枚举会让
   *  滑杆给得出的值提交必被 400。时长唯一来源为基础行 `supported_durations`（对象 `{min,max,step}`）。
   *  读侧分支暂留未删（待 `-1` 接入时一并处置），但**不要再往数据里配它**。见 ADR-0086 修订段。
   *  当前只有 `allowed_ratios` 在用。 */
  task_types: Record<string, unknown> | null;
  /** 视频的输出像素表：`"resolution=480p|aspect_ratio=16:9" → "864x496"`；未配为 null。
   *
   *  **为什么在能力行而不是定价目录**：这张表只在**预扣**用（估 token），而预扣是 backend 发起的，
   *  它可以按规格查表、把宽高冻成两个标量随 Hold 带过去。对照组是单价——单价在**结算**用，
   *  那一刻只有 billing 在场（`JobEventConsumer → settlement.settle`，backend 不在链路里），
   *  所以单价必须住 billing 自己的库。像素是按**用它的时刻**决定归属的。
   *
   *  口径与图片的 `request_mapping.matrix` 同构（图片：像素在能力行、单价在目录）。
   *
   *  ⚠️ 键格式与目录里原先那张 `tokenEstimate.dimensions` **逐字相同**，搬迁是逐字搬；
   *     `adaptive` 也照样是一个显式键，不在代码里做「取该档位的 16:9 格」这种推断。 */
  video_dimensions: Record<string, string> | null;
  /** 样片模式放行位（IKIZQ7，契约 backend/libs/contracts/video-sample-mode.ts）。
   *  **默认关闭**——仅运营在能力行显式声明 `sample_mode: true` 的视频模型（Seedance 2.5）
   *  才能提交 `parameters.sample_mode=true` 的样片创建/报价；未声明一律拒绝。 */
  sample_mode: boolean;
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
  /** 计价规则（能力行的 `pricing` 列）：形态与定价目录里 `models.<id>.<type>` 那条逐字相同。
   *  接纳侧在 Hold 时把它序列化后随请求送给 billing；NULL = 还没搬，billing 回落目录。 */
  pricing: unknown;
  /** 生成渠道（`<家族>-<媒介>[-<协议>]`，封闭枚举）。**本行解析与出站的唯一来源**；
   *  落库为 NULL 的存量行由 `parseStoredChannel(raw, capability_type)` 按媒介回落。 */
  channel: string | null;
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
};

type FeaturesJson = {
  referenceImage?: boolean;
  reference_image?: boolean;
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
  videoDimensions?: unknown;
  video_dimensions?: unknown;
  sampleMode?: boolean;
  sample_mode?: boolean;
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

/** 读侧：像素表为「非空串 → 非空串」的扁平 JSON 对象（宽容降级 null = 未配）。
 *  形态是否合法（键必须是 `resolution=X|aspect_ratio=Y`、值必须是 `WxH`）由**写侧闸门**判定，
 *  与 `task_types` 同一条分工；读侧只保证「是个字符串映射」，脏值留给消费方按「查不到」处理。 */
function pickDimensions(v: unknown): Record<string, string> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.length === 0) continue;
    if (typeof val !== "string" || val.length === 0) continue;
    out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 能力行 features JSON → 归一化的 {@link ModelFeatures}。
 *
 *  导出原因（IKHBDO）：scene-card 再生成拿到的 features 是**库中原始 JSON**（历史行可能仍是
 *  camelCase 形态），冻结参考上限前必须先走同一条归一，否则 camelCase 行冻结不出任何字段 →
 *  worker 回落旧常量 → 配置输给写死的缺省。接纳侧经 ModelCapabilityRepo 读出的已是归一结果。
 *
 *  IKHEXG：`capabilityType` 用于选 `image_reference_max` 的缺省——该键服务三种生成，
 *  而官方值按生成类型分叉（图片/视频 10、音频 1）。调用点都拿得到行的类型：
 *  `listEnabledByType(capabilityType)` 与 scene-card 再生成的 Prisma 原始行。 */
export function toFeatures(json: unknown, capabilityType?: string): ModelFeatures {
  const f = (json ?? {}) as FeaturesJson;
  return {
    reference_image: f.referenceImage === true || f.reference_image === true,
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
    // IK6PA5：缺省不能兜底 0——前端 atReferenceLimit = referenceCount >= image_reference_max
    // 在 0 上限时恒 true，上传入口被静默禁用。
    // IKHEXG：缺省按行的生成类型分——音频生成官方只收 1 张图（且不可与音频参考混用），
    // 图片/视频生成对齐网关/ARK 的 10。类型未知时取更宽松的 10，避免误拦。
    image_reference_max:
      pickNonNegativeInt(f.imageReferenceMax ?? f.image_reference_max) ??
      (capabilityType === "audio"
        ? DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO
        : DEFAULT_IMAGE_REFERENCE_MAX),
    max_reference_duration_sec: pickPositiveNumber(
      f.maxReferenceDurationSec ?? f.max_reference_duration_sec,
    ),
    task_types: pickTaskTypes(f.taskTypes ?? f.task_types),
    video_dimensions: pickDimensions(f.videoDimensions ?? f.video_dimensions),
    // IKIZQ7：缺省即关闭——样片能力默认不向任何模型开放（放行 = 能力行显式声明）。
    sample_mode: f.sampleMode === true || f.sample_mode === true,
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
      // IKH BDO：cache-aside。这是生成链路每次建任务都要走的白名单查询，
      // 而配置极低频——缓存把热路径从「每次查库」降成「每 5 分钟查一次」。
      // 失效由管理端各写方法显式触发（见 model-capability-admin-repo）。
      const cached = await getModelCapabilityList(capabilityType);
      if (cached) return cached;
      const rows = await prisma.generation_model_capability.findMany({
        where: { capability_type: capabilityType, enabled: true, is_delete: false },
        orderBy: { sort_order: "asc" },
      });
      const views = rows.map((cap) => ({
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
        features: toFeatures(cap.features, capabilityType),
        channel:
          typeof cap.channel === "string" && cap.channel.length > 0
            ? cap.channel
            : null,
        request_mapping: cap.request_mapping ?? null,
        pricing: cap.pricing ?? null,
        is_default: cap.is_default === true,
        version: cap.version,
        digest: capabilityDigestFromModelCapability(cap),
      }));
      await setModelCapabilityList(capabilityType, views);
      return views;
    },
  };
}
