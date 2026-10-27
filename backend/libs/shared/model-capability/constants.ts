import {
  CHANNEL_IDS,
  channelOf,
  defaultChannelFor,
  isChannelId,
  validateChannel,
  validateRequestMapping,
  type ChannelId,
  type ImageChannelParserId,
} from "../generation/image-channel-parser.js";


import { VIDEO_MODES, parsePixels, parseSpecKey } from "@lib/contracts";

export const MODEL_CAPABILITY_TYPES = ["image", "video", "text", "audio"] as const;
export type ModelCapabilityType = (typeof MODEL_CAPABILITY_TYPES)[number];

export const MODEL_CAPABILITY_LABELS: Record<ModelCapabilityType, string> = {
  image: "图片",
  video: "视频",
  text: "文生文",
  audio: "音频",
};

export const DEFAULT_MAX_REFERENCE_IMAGE_PIXELS = 36_000_000;

export const DEFAULT_MAX_REFERENCE_IMAGE_RATIO = 16;

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


  channel?: ChannelId;
  request_mapping?: unknown;

  pricing?: unknown | null;
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

  channel?: ChannelId;
  request_mapping?: unknown;

  pricing?: unknown | null;
  enabled?: boolean;
  sort_order?: number;
};


const I2I_MODEL_NAME_MAX = 128;
const MAX_PROMPT_LENGTH_LIMIT = 65_535;


const MAX_REFERENCE_COUNT = 1_000;


const MAX_QUANTITY_MAX = 100;


function camelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}






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

  for (const key of ["video_reference", "audio_reference", "sample_mode", "omni_reference_task_type"] as const) {
    const alias =
      key === "video_reference" ? "videoReference"
      : key === "audio_reference" ? "audioReference"
      : key === "sample_mode" ? "sampleMode"
      : "omniReferenceTaskType";
    const v = features[key] ?? features[alias];
    if (v !== undefined && v !== null && typeof v !== "boolean")
      return `${key}须为布尔值`;
  }

  for (const key of ["video_reference_max", "audio_reference_max", "image_reference_max"] as const) {
    const v = features[key] ?? features[key === "video_reference_max" ? "videoReferenceMax" : key === "audio_reference_max" ? "audioReferenceMax" : "imageReferenceMax"];
    if (v !== undefined && v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_REFERENCE_COUNT)
        return `${key}须为 0–${MAX_REFERENCE_COUNT} 的非负整数或 null`;
    }
  }

  const dur = features.max_reference_duration_sec ?? features.maxReferenceDurationSec;
  if (dur !== undefined && dur !== null) {
    if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0 || dur > 86_400)
      return `参考素材总时长上限(max_reference_duration_sec)须为正数秒（≤86400）或 null`;
  }

  const refImagePixels =
    features.max_reference_image_pixels ?? features.maxReferenceImagePixels;
  if (refImagePixels !== undefined && refImagePixels !== null) {
    if (
      typeof refImagePixels !== "number" ||
      !Number.isInteger(refImagePixels) ||
      refImagePixels < 1 ||
      refImagePixels > 1_000_000_000
    )
      return `参考图总像素上限(max_reference_image_pixels)须为 1–10 亿的整数或 null`;
  }

  const refImageRatio =
    features.max_reference_image_ratio ?? features.maxReferenceImageRatio;
  if (refImageRatio !== undefined && refImageRatio !== null) {
    if (
      typeof refImageRatio !== "number" ||
      !Number.isFinite(refImageRatio) ||
      refImageRatio <= 0 ||
      refImageRatio > 100
    )
      return `参考图宽高比上限(max_reference_image_ratio)须为 0–100 的正数或 null`;
  }

  const taskTypes = features.task_types ?? features.taskTypes;
  if (taskTypes !== undefined && taskTypes !== null) {
    if (!isPlainObject(taskTypes))
      return "任务类型约束(task_types)须为 JSON 对象";
    for (const [mode, entry] of Object.entries(taskTypes as Record<string, unknown>)) {
      if (!(VIDEO_MODES as readonly string[]).includes(mode))
        return `视频模式(task_types)的键须为 ${VIDEO_MODES.join(" / ")}，实为「${mode}」`;
      if (!isPlainObject(entry))
        return `视频模式(task_types.${mode})须为 JSON 对象`;
      const ratios = (entry as Record<string, unknown>).allowed_ratios;
      if (ratios !== undefined && ratios !== null) {
        if (
          !Array.isArray(ratios) ||
          !ratios.every((r) => typeof r === "string" && r.length > 0)
        )
          return `视频模式比例(task_types.${mode}.allowed_ratios)须为非空字符串数组或 null`;
      }
      const autoDuration = (entry as Record<string, unknown>).allow_auto_duration;
      if (autoDuration !== undefined && autoDuration !== null && typeof autoDuration !== "boolean")
        return `视频模式自动时长(task_types.${mode}.allow_auto_duration)须为布尔值或 null`;
      const durations = (entry as Record<string, unknown>).allowed_durations;
      if (durations !== undefined && durations !== null) {
        if (!Array.isArray(durations) || durations.length !== 1 || durations[0] !== -1)
          return `视频模式时长(task_types.${mode}.allowed_durations)只允许 [-1]`;
      }
    }
  }



  const videoDimensions = features.video_dimensions ?? features.videoDimensions;
  if (videoDimensions !== undefined && videoDimensions !== null) {
    if (!isPlainObject(videoDimensions)) return "输出像素表(video_dimensions)须为 JSON 对象";
    for (const [specKey, pixels] of Object.entries(videoDimensions as Record<string, unknown>)) {
      const parsedKey = parseSpecKey(specKey);
      if (parsedKey === null)
        return `输出像素表(video_dimensions)的键须形如 resolution=480p|aspect_ratio=16:9，实为「${specKey}」`;
      if (typeof pixels !== "string" || parsePixels(pixels) === null)
        return `输出像素表(video_dimensions)的值须形如 宽x高（正整数），键「${specKey}」实为「${String(pixels)}」`;
    }
  }






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





function isDurationRange(v: unknown): boolean {
  if (v === null) return true;
  if (Array.isArray(v)) {




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

function isRatioOptions(v: unknown): boolean {
  if (isStringArray(v)) return true;
  if (!isSizeArray(v)) return false;
  return (v as Array<{ label?: unknown }>).every(
    (item) =>
      item.label === undefined ||
      item.label === null ||
      typeof item.label === "string",
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
    | "ratioOptions"
    | "stringArray"
    | "numberArray"
    | "nullNumberArray"
    | "features",
): string | null {
  if (v === undefined) return null;
  if (allowed === "sizes" && !isSizeArray(v))
    return `${label}须为 [{ id, label? }] 数组`;
  if (allowed === "ratioOptions" && !isRatioOptions(v))
    return `${label}须为 [{ id, label? }] 数组（存量裸字符串亦可）`;
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











function pickNotNullString(v: unknown): string | undefined {
  if (v === null) return "";
  return pickString(v);
}






const PRICING_BASE_UNITS = new Set([
  "constant:1",
  "usage.succeededSlots",
  "usage.seconds",
  "usage.characters",
  "usage.referenceCount",
  "usage.referenceSeconds",
  "usage.videoEdit",
  "usage.p",
  "usage.c",
  "usage.cr",
  "usage.cc5m",
  "usage.cc1h",
  "usage.reasoning",
  "usage.imgIn",
  "usage.audioIn",
  "usage.len",
]);


const PRICING_ROUNDINGS = new Set(["halfUp", "ceil", "floor"]);


const PRICING_KINDS = new Set(["const", "table", "unset"]);















export function pricingFieldErr(pricing: unknown, channel?: ChannelId): string | null {
  if (pricing === undefined || pricing === null) return null;
  if (!isPlainObject(pricing)) return "计价规则(pricing)须为 JSON 对象或 null";

  const baseUnit = pricing.baseUnit;
  if (typeof baseUnit !== "string" || baseUnit.length === 0) {
    return "计价规则(pricing).baseUnit 必填（基准维度，如 usage.c / constant:1）";
  }
  if (!PRICING_BASE_UNITS.has(baseUnit)) {
    return `计价规则(pricing).baseUnit 未知：「${baseUnit}」（见 billing 的 UsageDim 枚举）`;
  }

  const price = pricing.basePrice;
  if (!isPlainObject(price)) {
    return "计价规则(pricing).basePrice 必填（{kind: const|table|unset, ...}）";
  }
  const kind = price.kind;
  if (typeof kind !== "string" || !PRICING_KINDS.has(kind)) {
    return `计价规则(pricing).basePrice.kind 须为 const / table / unset，实为「${String(kind)}」`;
  }
  if (kind === "const") {
    if (typeof price.value !== "number") {
      return "计价规则(pricing).basePrice.kind=const 时必须给数值 value";
    }






    if (price.value < 0) {
      return (
        `计价规则(pricing).basePrice.value 不能为负（实为 ${String(price.value)}）：` +
        `负单价经下限兜底后变成 0，整单免费且账面无信号；要表达「免费」请直接写 0，并用 minCredits 定下限`
      );
    }
  }
  if (kind === "table") {
    if (!isPlainObject(price.table) || Object.keys(price.table).length === 0) {
      return "计价规则(pricing).basePrice.kind=table 时必须给非空 table";
    }

    for (const [axis, v] of Object.entries(price.table)) {
      if (typeof v !== "number" || v < 0) {
        return (
          `计价规则(pricing).basePrice.table.${axis} 不能为负（实为 ${String(v)}）：` +
          `负单价经下限兜底后变成 0`
        );
      }
    }
  }

  const denom = pricing.unitDenominator;
  if (denom !== undefined && denom !== null) {
    if (typeof denom !== "number" || !Number.isInteger(denom) || denom <= 0) {
      return "计价规则(pricing).unitDenominator 须为正整数（1 = 每秒/每张；60 = 每分钟）";
    }
  }
  for (const key of ["quantityOffset", "quantityStep"] as const) {
    const v = pricing[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return `计价规则(pricing).${key} 须为非负整数`;
    }
  }
  for (const key of ["minCredits", "maxCredits"] as const) {
    const v = pricing[key];
    if (v !== undefined && v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return `计价规则(pricing).${key} 须为非负整数`;
      }
    }
  }
  const rounding = pricing.rounding;
  if (rounding !== undefined && rounding !== null) {
    if (typeof rounding !== "string" || !PRICING_ROUNDINGS.has(rounding)) {
      return `计价规则(pricing).rounding 须为 halfUp / ceil / floor，实为「${String(rounding)}」`;
    }
  }
  for (const key of ["dims", "multipliers"] as const) {
    const v = pricing[key];
    if (v === undefined || v === null) continue;
    if (!isPlainObject(v)) return `计价规则(pricing).${key} 须为 JSON 对象`;
    for (const [axis, raw] of Object.entries(v)) {
      if (!PRICING_BASE_UNITS.has(axis)) {
        return `计价规则(pricing).${key} 的键须为基准维度，实为「${axis}」`;
      }




      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        return `计价规则(pricing).${key}.${axis} 须为整数（万分比），实为 ${String(raw)}`;
      }
      if (key === "multipliers" && raw <= 0) {
        return (
          `计价规则(pricing).multipliers.${axis} 须为正整数（实为 ${raw}）：` +
          `0 会让整单免费，「这一维不参与」应当是不写它`
        );
      }
      if (key === "dims" && raw < 0) {
        return `计价规则(pricing).dims.${axis} 不能为负（实为 ${raw}）：负倍率把等效数量拉低，等于少收`;
      }
    }
  }





  const dimPrices = pricing.dimPrices;
  if (dimPrices !== undefined && dimPrices !== null) {
    if (!isPlainObject(dimPrices)) return "计价规则(pricing).dimPrices 须为 JSON 对象";
    for (const [axis, spec] of Object.entries(dimPrices)) {
      if (!PRICING_BASE_UNITS.has(axis)) {
        return `计价规则(pricing).dimPrices 的键须为基准维度，实为「${axis}」`;
      }
      if (!isPlainObject(spec)) {
        return `计价规则(pricing).dimPrices.${axis} 须为对象 { unitMc: number, firstFree?: boolean }`;
      }
      const unitMc = spec.unitMc;


      if (typeof unitMc !== "number" || !Number.isInteger(unitMc) || unitMc <= 0) {
        return `计价规则(pricing).dimPrices.${axis}.unitMc 须为正整数（单位是 mc，与 basePrice.value 相同：`
          + "1 积分 = 1000 mc。要让这个维度不计费，请整块删掉它，别写 0）";
      }
      if (spec.firstFree !== undefined && spec.firstFree !== null
          && typeof spec.firstFree !== "boolean") {
        return `计价规则(pricing).dimPrices.${axis}.firstFree 须为布尔（缺省 = 不免费）`;
      }
    }



    if (typeof pricing.maxCredits === "number") {
      return "计价规则(pricing).dimPrices 与 maxCredits 不能同时配："
        + "上限计价跳过用量计算、算不到维度绝对加价，预扣会冻结一份不含加价的额度，"
        + "结算超出后只记应收（少收且静默）。二选一";
    }
  }

  if (channel !== undefined) {

    if (channelOf(channel).media === "audio" && baseUnit === "usage.seconds"
        && (pricing.maxCredits === undefined || pricing.maxCredits === null)) {
      return "音频按 usage.seconds 计价必须同时配 maxCredits："
        + "音频时长在提交时刻取不到（TTS 由文案决定，请求里没有 duration），"
        + "billing 只能「按上限冻结、结算按实际重算」；不配上限则该模型的每一次提交都会被拒。"
        + "上限按官方单次输出上限（2 分钟）折算，并留一点余量";
    }
  }
  return null;
}

function parseChannelAndMapping(
  body: Record<string, unknown>,
  mode: "create" | "update",
  capabilityType: unknown,
  current?: { channel?: unknown; supported_sizes?: unknown },
): ParseResult<{
  channel?: ChannelId;

  effectiveChannel?: ChannelId;
  request_mapping?: unknown;
}> {
  if (body.channel !== undefined && !isChannelId(body.channel)) {
    return { ok: false, error: `渠道(channel)只支持 ${CHANNEL_IDS.join(" / ")}` };
  }
  const explicit = isChannelId(body.channel) ? body.channel : null;


  if (explicit !== null) {
    const channelErr = validateChannel(explicit, capabilityType);
    if (channelErr) return { ok: false, error: channelErr };
  }



  const stored = mode === "update" && isChannelId(current?.channel) ? current.channel : null;


  const channel: ChannelId | null = explicit ?? (mode === "create" ? defaultChannelFor(capabilityType) : null);





  const effectiveChannel = channel ?? stored;
  const parser: ImageChannelParserId =
    channel !== null ? channelOf(channel).parser ?? "seedream"
    : stored !== null ? channelOf(stored).parser ?? "seedream"
    : "seedream";










  const currentParserIsSeedream = stored !== null && channelOf(stored).parser === "seedream";
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



  if (explicit !== null && parser !== "seedream" && !mappingProvided) {
    return { ok: false, error: "request_mapping 不能为空" };
  }
  if (mappingProvided) {



    const sizesForGate = body.supported_sizes ?? current?.supported_sizes;
    const mappingErr = validateRequestMapping(parser, body.request_mapping, sizesForGate);
    if (mappingErr) return { ok: false, error: mappingErr };
  }
  return {
    ok: true,
    value: {

      ...(channel !== null ? { channel } : {}),
      ...(effectiveChannel !== null ? { effectiveChannel } : {}),
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
      "ratioOptions",
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

  const parsedMapping = parseChannelAndMapping(body, "create", body.capability_type);
  if (!parsedMapping.ok) return parsedMapping;

  const pricingErr = pricingFieldErr(body.pricing, parsedMapping.value.effectiveChannel);
  if (pricingErr) return { ok: false, error: pricingErr };

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
      ...(body.pricing !== undefined ? { pricing: body.pricing } : {}),
      ...parsedMapping.value,
      ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
    },
  };
}






export function parseModelUpdateBody(
  body: unknown,
  current?: { channel?: unknown; capability_type?: unknown; supported_sizes?: unknown },
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
      "ratioOptions",
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
  const parsedMapping = parseChannelAndMapping(body, "update", current?.capability_type, current);
  if (!parsedMapping.ok) return parsedMapping;

  const pricingErr = pricingFieldErr(body.pricing, parsedMapping.value.effectiveChannel);
  if (pricingErr) return { ok: false, error: pricingErr };

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
      ...(body.pricing !== undefined && { pricing: body.pricing }),
      ...parsedMapping.value,
      ...(body.enabled !== undefined && { enabled: body.enabled as boolean }),
      ...(body.sort_order !== undefined && {
        sort_order: body.sort_order as number,
      }),
    },
  };
}
