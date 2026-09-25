import {
  IMAGE_CHANNEL_PARSERS,
  isImageChannelParserId,
  validateRequestMapping,
  type ImageChannelParserId,
} from "../generation/image-channel-parser.js";

export const MODEL_CAPABILITY_TYPES = ["image", "video", "text", "audio"] as const;
export type ModelCapabilityType = (typeof MODEL_CAPABILITY_TYPES)[number];

export const MODEL_CAPABILITY_LABELS: Record<ModelCapabilityType, string> = {
  image: "图片",
  video: "视频",
  text: "文生文",
  audio: "音频",
};

export const MODEL_FIELD_LIMITS = {
  provider_id: 32,
  model_id: 128,
  capability_type: 16,
  model_label: 64,
  icon: 512,
  default_size: 32,
  default_format: 16,
  default_aspect_ratio: 16,
} as const;

export const DEFAULT_PROVIDER_ID = "new-api";

export type ModelCreatePayload = {
  provider_id: string;
  model_id: string;
  capability_type: string;
  model_label: string;
  icon?: string | null;
  supported_sizes?: unknown;
  supported_aspect_ratios?: unknown;
  supported_durations?: unknown | null;
  supported_formats?: unknown;
  default_size?: string;
  default_format?: string | null;
  default_aspect_ratio?: string;
  default_duration?: number | null;
  features?: unknown;
  channel_parser?: ImageChannelParserId;
  request_mapping?: unknown;
  enabled?: boolean;
};

export type ModelUpdatePayload = {
  model_label?: string;
  icon?: string | null;
  supported_sizes?: unknown;
  supported_aspect_ratios?: unknown;
  supported_durations?: unknown | null;
  supported_formats?: unknown;
  default_size?: string;
  default_format?: string | null;
  default_aspect_ratio?: string;
  default_duration?: number | null;
  features?: unknown;
  channel_parser?: ImageChannelParserId;
  request_mapping?: unknown;
  enabled?: boolean;
  sort_order?: number;
};

/** 上游模型名长度与 model_id 列宽对齐；prompt 上限取一个足够宽的工程硬顶。 */
const I2I_MODEL_NAME_MAX = 128;
const MAX_PROMPT_LENGTH_LIMIT = 65_535;

/** ADR-0086：参考素材限制键的上限（防运营误配海量值污染前端/校验）。 */
const MAX_REFERENCE_COUNT = 1_000;

/** 单次输出上限的量级闸门；上游 `expected_output_count` 另有 1–4 的硬校验。 */
const MAX_QUANTITY_MAX = 100;

/** snake_case → camelCase。读侧（toFeatures / worker-java）两种键形都认，写闸门同理。 */
function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** features 已知扩展键的写入闸门（IKESD6）：i2i_model_name / max_prompt_length；
 *  ADR-0086 追加参考素材限制键 video_reference / video_reference_max / audio_reference /
 *  audio_reference_max / image_reference_max / max_reference_duration_sec / task_types。
 *  读侧（toFeatures）对脏值宽容降级默认，写侧必须拒绝——否则管理端下次整包提交
 *  会把错误类型固化回库。兼容 snake_case / camelCase 两种键形。 */
function featuresFieldErr(features: unknown): string | null {
  if (!isPlainObject(features)) return null;
  const alias = features.i2i_model_name ?? features.i2iModelName;
  if (alias !== undefined && alias !== null) {
    if (typeof alias !== "string" || alias.trim().length === 0)
      return "图生图模型名(i2i_model_name)须为非空字符串或 null";
    if (alias.length > I2I_MODEL_NAME_MAX)
      return `图生图模型名(i2i_model_name)超长（≤${I2I_MODEL_NAME_MAX}字符）`;
  }
  const len = features.max_prompt_length ?? features.maxPromptLength;
  if (len !== undefined && len !== null) {
    if (
      typeof len !== "number" ||
      !Number.isInteger(len) ||
      len < 1 ||
      len > MAX_PROMPT_LENGTH_LIMIT
    )
      return `提示词上限(max_prompt_length)须为 1–${MAX_PROMPT_LENGTH_LIMIT} 的整数或 null`;
  }
  // ADR-0086 布尔能力位
  for (const key of ["video_reference", "audio_reference"] as const) {
    const v = features[key] ?? features[key === "video_reference" ? "videoReference" : "audioReference"];
    if (v !== undefined && v !== null && typeof v !== "boolean")
      return `${key}须为布尔值`;
  }
  // ADR-0086 数量上限（非负整数，可显式 0 禁用）
  for (const key of ["video_reference_max", "audio_reference_max", "image_reference_max"] as const) {
    const v = features[key] ?? features[key === "video_reference_max" ? "videoReferenceMax" : key === "audio_reference_max" ? "audioReferenceMax" : "imageReferenceMax"];
    if (v !== undefined && v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_REFERENCE_COUNT)
        return `${key}须为 0–${MAX_REFERENCE_COUNT} 的非负整数或 null`;
    }
  }
  // ADR-0086 参考素材总时长上限（正数秒或 null）
  const dur = features.max_reference_duration_sec ?? features.maxReferenceDurationSec;
  if (dur !== undefined && dur !== null) {
    if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0 || dur > 86_400)
      return `参考素材总时长上限(max_reference_duration_sec)须为正数秒（≤86400）或 null`;
  }
  // ADR-0086 task_types 对象
  const taskTypes = features.task_types ?? features.taskTypes;
  if (taskTypes !== undefined && taskTypes !== null) {
    if (!isPlainObject(taskTypes))
      return "任务类型约束(task_types)须为 JSON 对象";
  }
  // IKH BDO：闸门此前只覆盖上面这些键，能力行的主流键（数量上限 / 各布尔位）任意类型都能入库
  // ——"abc" / 1.5 照收。读侧再宽容降级也救不回来：脏值一旦落库，管理端下次整包提交就把它固化了。
  // 按同一原则补齐。
  //
  // IKHEXG：参考图上限原先在这一段单独校一遍（当时它还叫 max_reference_images，不在上面的
  // ADR-0086 键表里）；合并进 `image_reference_max` 后已由上面的数量上限循环覆盖，此处删除重复段。
  const quantityMax = features.quantity_max ?? features.quantityMax;
  if (quantityMax !== undefined && quantityMax !== null) {
    if (
      typeof quantityMax !== "number" ||
      !Number.isInteger(quantityMax) ||
      quantityMax < 1 ||
      quantityMax > MAX_QUANTITY_MAX
    )
      return `单次输出上限(quantity_max)须为 1–${MAX_QUANTITY_MAX} 的整数或 null`;
  }
  for (const key of [
    "reference_image",
    "watermark",
    "audio",
    "tools",
    "first_frame",
    "last_frame",
    "first_last_frame",
    "sequential_image_generation",
    "stream",
  ] as const) {
    const v = features[key] ?? features[camelKey(key)];
    if (v !== undefined && v !== null && typeof v !== "boolean")
      return `${key}须为布尔值`;
  }
  // 出站图片协议名；未知取值 worker-java 回落 inline-image 并告警，故这里只卡类型。
  const protocol = features.image_protocol ?? features.imageProtocol;
  if (protocol !== undefined && protocol !== null) {
    if (typeof protocol !== "string" || protocol.trim().length === 0)
      return "图片协议(image_protocol)须为非空字符串或 null";
  }
  return null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/** IKG4UR：`supported_durations` 的合法形态——数字数组、时长范围对象 `{min,max,step?}` 或 null。
 *  库中两种形态长期并存：数组在读侧按 `[min,max,step]` 解析（见 toDurationRange），对象是区间的显式写法。
 *  写侧此前只收数组，后台把对象行读成空后写回 null，直接把该行清空。
 *  放行对象才能做到「读什么写什么」——一次保存不改变该行原本的语义。 */
function isDurationRange(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) {
    // 数组是历史形态，读侧仍在生效（toDurationRange 按 [min,max,step] 解析）。
    // 但只有「能构成合法区间」的才放行——`[]` / `[5]` / `[30,4]` / 负值 / step<=0
    // 都会造出「滑杆消失 + 该模型任何时长都被 400」的坏行，且后台因 min>max 也修不回。
    // 形态唯一性由写入闸门兜底，不能只靠前端。
    return (
      v.length >= 2 &&
      v.length <= 3 &&
      v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) &&
      (v[0] as number) <= (v[1] as number) &&
      (v[2] === undefined || (v[2] as number) > 0)
    );
  }
  if (!isPlainObject(v)) return false;
  const { min, max, step } = v as Record<string, unknown>;
  if (typeof min !== "number" || !Number.isFinite(min) || min < 0) return false;
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0) return false;
  if (min > max) return false;
  if (step === undefined || step === null) return true;
  return typeof step === "number" && Number.isFinite(step) && step > 0;
}

function isSizeArray(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every(
      (x) => isPlainObject(x) && typeof x.id === "string" && x.id.length > 0,
    )
  );
}

function reqString(v: unknown, limit: number, label: string): string | null {
  if (typeof v !== "string") return `${label}须为字符串`;
  if (v.length === 0) return `${label}不能为空`;
  if (v.length > limit) return `${label}超长（≤${limit}字符）`;
  return null;
}

function jsonField(
  v: unknown,
  label: string,
  allowed:
    | "sizes"
    | "stringArray"
    | "numberArray"
    | "nullNumberArray"
    | "features",
): string | null {
  if (v === undefined) return null;
  if (allowed === "sizes" && !isSizeArray(v))
    return `${label}须为 [{ id, label? }] 数组`;
  if (allowed === "stringArray" && !isStringArray(v))
    return `${label}须为字符串数组`;
  if (allowed === "numberArray" && !isNumberArray(v))
    return `${label}须为数字数组`;
  if (allowed === "nullNumberArray" && !isDurationRange(v))
    return `${label}须为数字数组、{min,max,step} 对象或 null`;
  if (allowed === "features" && !isPlainObject(v))
    return `${label}须为 JSON 对象`;
  return null;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function pickNullableString(v: unknown): string | null | undefined {
  return v == null ? null : typeof v === "string" ? v : undefined;
}

/** NOT NULL 字符串列（`default_size` / `default_aspect_ratio`）的取值归一。
 *
 *  IKHEXG：这两列在库里是 `VarChar NOT NULL`，「未配」的形态是**空串**；而表单把清空的状态
 *  发成 `null`（`form.defaultSize.trim() || null`），旧闸门又只收字符串 → 保存必然 400
 *  （本单实测：音频行 `PUT /api/admin/models/23` 报「默认尺寸(default_size)须为字符串」）。
 *  收 null 并归一为空串：与列形态一致，且保留「清空」的语义。
 *
 *  ⚠️ **创建与更新的语义不对称**（既有行为，非本次引入）：更新时空串就是空串；但创建时
 *  `default_size` 为空串会被 repo 的 `deriveDefaultSize` 顶成 `supported_sizes[0].id`
 *  （`model-capability-admin-repo.ts`）。别假设两个解析器对空串的处理一致。 */
function pickNotNullString(v: unknown): string | undefined {
  if (v === null) return "";
  return pickString(v);
}

function parseParserAndMapping(
  body: Record<string, unknown>,
  mode: "create" | "update",
  currentParser?: unknown,
  currentSizes?: unknown,
): ParseResult<{
  channel_parser?: ImageChannelParserId;
  request_mapping?: unknown;
}> {
  if (body.channel_parser !== undefined && !isImageChannelParserId(body.channel_parser)) {
    return {
      ok: false,
      error: `生成渠道解析器只支持 ${IMAGE_CHANNEL_PARSERS.join(" / ")}`,
    };
  }
  // update 是 diff 提交——没改过的 channel_parser 不在请求体里。解析器必须回落到
  // **库中该行**的值，否则下面整段映射校验会被跳过：GPT 行删空矩阵、Seedream 行
  // 映射表被清空都是从这条缝漏过去的（解析器未知 ⇒ 不校验 ⇒ 脏值直接落库）。
  const rawParser = body.channel_parser;
  const parserExplicit = isImageChannelParserId(rawParser);
  const parser: ImageChannelParserId = parserExplicit
    ? rawParser
    : mode === "create"
      ? "seedream"
      : isImageChannelParserId(currentParser)
        ? currentParser
        : "seedream";
  // Seedream 行的映射表是 IK629 之后尺寸换算的唯一来源（worker-java hasSizeMatrix
  // 判假即回退成「直传 provider size」，而那正是 024 迁移要修的 400 Invalid size）。
  // 后台没有「清空矩阵」入口，所以对一个**本来就是 seedream** 的行，客户端传的 null
  // 不是运营意图、是 diff 提交的产物——按「不改」处理。
  //
  // 但「本来不是 seedream」的行不能这么办：把 gpt 行切到 seedream 时，前端同样只发
  // null，而那个 null 就是「gpt 的矩阵不再适用」的唯一表达。当成「不改」会把上一族的
  // 矩阵留在行里，worker 拿它去算 seedream 的尺寸，而界面上没有任何入口能再清掉它。
  const currentParserIsSeedream =
    isImageChannelParserId(currentParser) && currentParser === "seedream";
  const clearSeedreamMapping =
    parser === "seedream" &&
    body.request_mapping === null &&
    currentParserIsSeedream;
  const mappingProvided = body.request_mapping !== undefined && !clearSeedreamMapping;
  if (
    mappingProvided &&
    body.request_mapping !== null &&
    body.request_mapping !== undefined
  ) {
    const mappingTypeErr = jsonField(
      body.request_mapping,
      "映射(request_mapping)",
      "features",
    );
    if (mappingTypeErr) return { ok: false, error: mappingTypeErr };
  }
  // 显式声明切到 gpt / banana 时必须同时给出映射表——否则切完是一张空表，
  // 该模型每次请求都 empty_mapping。缺省不传 channel_parser 时表示「不改」，
  // 那一行的映射表原样留在库里，由上面的 currentParser 兜底校验。
  if (parserExplicit && parser !== "seedream" && !mappingProvided) {
    return { ok: false, error: "request_mapping 不能为空" };
  }
  if (mappingProvided) {
    // ⚠️ 档位清单（supported_sizes）也是 diff 提交：没改过的尺寸不在 body 里。seedream 的
    //    矩阵键校验要拿它当**合法键集合**，所以与 channel_parser 同一套回落 —— 用库中那一行。
    //    （少了这一步，一次「只改矩阵」的保存会因为拿不到档位而跳过校验，闸门形同虚设。）
    const sizesForGate = body.supported_sizes ?? currentSizes;
    const mappingErr = validateRequestMapping(parser, body.request_mapping, sizesForGate);
    if (mappingErr) return { ok: false, error: mappingErr };
  }
  return {
    ok: true,
    value: {
      // 新建恒带解析器（缺省 seedream）；更新只在显式声明时才提交，否则会覆盖库里那一行。
      ...(parserExplicit || mode === "create" ? { channel_parser: parser } : {}),
      ...(mappingProvided ? { request_mapping: body.request_mapping } : {}),
    },
  };
}

function pickNullableDuration(v: unknown): number | null | undefined {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (!Number.isInteger(v) || v < 0 || v > 2_147_483_647) return undefined;
  return v;
}

export function parseModelCreateBody(
  body: unknown,
): ParseResult<ModelCreatePayload> {
  if (!isPlainObject(body)) return { ok: false, error: "请求体须为 JSON 对象" };

  const err =
    reqString(body.model_id, MODEL_FIELD_LIMITS.model_id, "模型ID(model_id)") ??
    reqString(
      body.capability_type,
      MODEL_FIELD_LIMITS.capability_type,
      "类型(capability_type)",
    ) ??
    reqString(
      body.model_label,
      MODEL_FIELD_LIMITS.model_label,
      "展示名(model_label)",
    );
  if (err) return { ok: false, error: err };

  if (
    !MODEL_CAPABILITY_TYPES.includes(
      body.capability_type as ModelCapabilityType,
    )
  ) {
    return {
      ok: false,
      error: "类型(capability_type)只支持 image / video / text / audio",
    };
  }

  const jsonErr =
    jsonField(body.supported_sizes, "尺寸(supported_sizes)", "sizes") ??
    jsonField(
      body.supported_aspect_ratios,
      "比例(supported_aspect_ratios)",
      "stringArray",
    ) ??
    jsonField(
      body.supported_durations,
      "时长(supported_durations)",
      "nullNumberArray",
    ) ??
    jsonField(
      body.supported_formats,
      "格式(supported_formats)",
      "stringArray",
    ) ??
    jsonField(body.features, "特性(features)", "features");
  if (jsonErr) return { ok: false, error: jsonErr };
  const featuresErr = featuresFieldErr(body.features);
  if (featuresErr) return { ok: false, error: featuresErr };

  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return { ok: false, error: "启用(enabled)须为布尔值" };
  }

  const icon = pickNullableString(body.icon);
  if (icon === undefined)
    return { ok: false, error: "图标(icon)须为字符串或 null" };
  if (icon !== null && icon.length > MODEL_FIELD_LIMITS.icon)
    return {
      ok: false,
      error: `图标(icon)超长（≤${MODEL_FIELD_LIMITS.icon}字符）`,
    };

  const defaultSize = pickNotNullString(body.default_size);
  if (
    defaultSize !== undefined &&
    defaultSize.length > MODEL_FIELD_LIMITS.default_size
  )
    return {
      ok: false,
      error: `默认尺寸(default_size)超长（≤${MODEL_FIELD_LIMITS.default_size}字符）`,
    };

  const defaultFormat = pickNullableString(body.default_format);
  if (defaultFormat === undefined)
    return { ok: false, error: "默认格式(default_format)须为字符串或 null" };
  if (
    defaultFormat !== null &&
    defaultFormat.length > MODEL_FIELD_LIMITS.default_format
  )
    return {
      ok: false,
      error: `默认格式(default_format)超长（≤${MODEL_FIELD_LIMITS.default_format}字符）`,
    };

  const defaultAspectRatio = pickNotNullString(body.default_aspect_ratio);
  if (
    defaultAspectRatio !== undefined &&
    defaultAspectRatio.length > MODEL_FIELD_LIMITS.default_aspect_ratio
  )
    return {
      ok: false,
      error: `默认比例(default_aspect_ratio)超长（≤${MODEL_FIELD_LIMITS.default_aspect_ratio}字符）`,
    };

  const defaultDuration = pickNullableDuration(body.default_duration);
  if (defaultDuration === undefined)
    return {
      ok: false,
      error: "默认时长(default_duration)须为非负整数秒（≤2147483647）或 null",
    };

  const parsedMapping = parseParserAndMapping(body, "create");
  if (!parsedMapping.ok) return parsedMapping;

  return {
    ok: true,
    value: {
      provider_id: DEFAULT_PROVIDER_ID,
      model_id: body.model_id as string,
      capability_type: body.capability_type as string,
      model_label: body.model_label as string,
      icon,
      supported_sizes: body.supported_sizes,
      supported_aspect_ratios: body.supported_aspect_ratios,
      supported_durations: body.supported_durations ?? null,
      supported_formats: body.supported_formats,
      ...(defaultSize !== undefined ? { default_size: defaultSize } : {}),
      default_format: defaultFormat,
      ...(defaultAspectRatio !== undefined
        ? { default_aspect_ratio: defaultAspectRatio }
        : {}),
      default_duration: defaultDuration,
      features: body.features,
      ...parsedMapping.value,
      ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
    },
  };
}

/** 校验管理端「更新模型」请求体。
 *
 *  `current` 是**库中当前那一行**（至少 `channel_parser`）。更新是 diff 提交，未变更的
 *  字段不在请求体里，光看 body 推不出该用哪个解析器做映射校验——必须由调用方把行读出来
 *  传进来。调用方须读库，**不得读缓存**：校验读到旧值等于没校验。 */
export function parseModelUpdateBody(
  body: unknown,
  current?: { channel_parser?: unknown; supported_sizes?: unknown },
): ParseResult<ModelUpdatePayload> {
  if (!isPlainObject(body)) return { ok: false, error: "请求体须为 JSON 对象" };

  if (body.model_label !== undefined) {
    const err = reqString(
      body.model_label,
      MODEL_FIELD_LIMITS.model_label,
      "展示名(model_label)",
    );
    if (err) return { ok: false, error: err };
  }
  if (body.icon !== undefined) {
    const icon = pickNullableString(body.icon);
    if (icon === undefined)
      return { ok: false, error: "图标(icon)须为字符串或 null" };
    if (icon !== null && icon.length > MODEL_FIELD_LIMITS.icon)
      return {
        ok: false,
        error: `图标(icon)超长（≤${MODEL_FIELD_LIMITS.icon}字符）`,
      };
  }
  // IKHEXG：两列是 NOT NULL，「清空」的合法表达是空串（不是 null）。收 null 归一为空串——
  // 只收字符串会让表单（对非图片/视频行恒发 null）保存必然 400，实测症状即此。
  const defaultSize = pickNotNullString(body.default_size);
  if (body.default_size !== undefined) {
    if (
      defaultSize === undefined ||
      defaultSize.length > MODEL_FIELD_LIMITS.default_size
    )
      return {
        ok: false,
        error: `默认尺寸(default_size)须为字符串、null（等价空串）且≤${MODEL_FIELD_LIMITS.default_size}字符`,
      };
  }
  if (body.default_format !== undefined) {
    const defaultFormat = pickNullableString(body.default_format);
    if (defaultFormat === undefined)
      return { ok: false, error: "默认格式(default_format)须为字符串或 null" };
  }
  const defaultAspectRatio = pickNotNullString(body.default_aspect_ratio);
  if (body.default_aspect_ratio !== undefined) {
    if (
      defaultAspectRatio === undefined ||
      defaultAspectRatio.length > MODEL_FIELD_LIMITS.default_aspect_ratio
    )
      return {
        ok: false,
        error: `默认比例(default_aspect_ratio)须为字符串、null（等价空串）且≤${MODEL_FIELD_LIMITS.default_aspect_ratio}字符`,
      };
  }
  if (body.default_duration !== undefined) {
    const defaultDuration = pickNullableDuration(body.default_duration);
    if (defaultDuration === undefined)
      return {
        ok: false,
        error: "默认时长(default_duration)须为非负整数秒（≤2147483647）或 null",
      };
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return { ok: false, error: "启用(enabled)须为布尔值" };
  }
  if (body.sort_order !== undefined) {
    const n = body.sort_order;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
      return { ok: false, error: "排序(sort_order)须为非负整数" };
  }

  const jsonErr =
    jsonField(body.supported_sizes, "尺寸(supported_sizes)", "sizes") ??
    jsonField(
      body.supported_aspect_ratios,
      "比例(supported_aspect_ratios)",
      "stringArray",
    ) ??
    jsonField(
      body.supported_durations,
      "时长(supported_durations)",
      "nullNumberArray",
    ) ??
    jsonField(
      body.supported_formats,
      "格式(supported_formats)",
      "stringArray",
    ) ??
    jsonField(body.features, "特性(features)", "features");
  if (jsonErr) return { ok: false, error: jsonErr };
  const featuresErr = featuresFieldErr(body.features);
  if (featuresErr) return { ok: false, error: featuresErr };

  const parsedMapping = parseParserAndMapping(
    body,
    "update",
    current?.channel_parser,
    current?.supported_sizes,
  );
  if (!parsedMapping.ok) return parsedMapping;

  return {
    ok: true,
    value: {
      ...(body.model_label !== undefined && {
        model_label: body.model_label as string,
      }),
      ...(body.icon !== undefined && {
        icon: pickNullableString(body.icon) as string | null,
      }),
      ...(body.supported_sizes !== undefined && {
        supported_sizes: body.supported_sizes,
      }),
      ...(body.supported_aspect_ratios !== undefined && {
        supported_aspect_ratios: body.supported_aspect_ratios,
      }),
      ...(body.supported_durations !== undefined && {
        supported_durations: body.supported_durations,
      }),
      ...(body.supported_formats !== undefined && {
        supported_formats: body.supported_formats,
      }),
      ...(body.default_size !== undefined && {
        default_size: defaultSize as string,
      }),
      ...(body.default_format !== undefined && {
        default_format: pickNullableString(body.default_format) as string | null,
      }),
      ...(body.default_aspect_ratio !== undefined && {
        default_aspect_ratio: defaultAspectRatio as string,
      }),
      ...(body.default_duration !== undefined && {
        default_duration: pickNullableDuration(body.default_duration) as
          | number
          | null,
      }),
      ...(body.features !== undefined && { features: body.features }),
      ...parsedMapping.value,
      ...(body.enabled !== undefined && { enabled: body.enabled as boolean }),
      ...(body.sort_order !== undefined && {
        sort_order: body.sort_order as number,
      }),
    },
  };
}
