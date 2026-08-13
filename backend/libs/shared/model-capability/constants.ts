export const MODEL_CAPABILITY_TYPES = ["image", "video", "text"] as const;
export type ModelCapabilityType = (typeof MODEL_CAPABILITY_TYPES)[number];

export const MODEL_CAPABILITY_LABELS: Record<ModelCapabilityType, string> = {
  image: "图片",
  video: "视频",
  text: "文生文",
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
  enabled?: boolean;
  sort_order?: number;
};

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
  if (allowed === "nullNumberArray" && v !== null && !isNumberArray(v))
    return `${label}须为数字数组或 null`;
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
    reqString(
      body.provider_id,
      MODEL_FIELD_LIMITS.provider_id,
      "供应商(provider_id)",
    ) ??
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
      error: "类型(capability_type)只支持 image / video / text",
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

  const defaultSize = pickString(body.default_size);
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

  const defaultAspectRatio = pickString(body.default_aspect_ratio);
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

  return {
    ok: true,
    value: {
      provider_id: body.provider_id as string,
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
      ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}),
    },
  };
}

export function parseModelUpdateBody(
  body: unknown,
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
  if (body.default_size !== undefined) {
    const defaultSize = pickString(body.default_size);
    if (
      defaultSize === undefined ||
      defaultSize.length > MODEL_FIELD_LIMITS.default_size
    )
      return {
        ok: false,
        error: `默认尺寸(default_size)须为字符串且≤${MODEL_FIELD_LIMITS.default_size}字符`,
      };
  }
  if (body.default_format !== undefined) {
    const defaultFormat = pickNullableString(body.default_format);
    if (defaultFormat === undefined)
      return { ok: false, error: "默认格式(default_format)须为字符串或 null" };
  }
  if (body.default_aspect_ratio !== undefined) {
    const defaultAspectRatio = pickString(body.default_aspect_ratio);
    if (
      defaultAspectRatio === undefined ||
      defaultAspectRatio.length > MODEL_FIELD_LIMITS.default_aspect_ratio
    )
      return {
        ok: false,
        error: `默认比例(default_aspect_ratio)须为字符串且≤${MODEL_FIELD_LIMITS.default_aspect_ratio}字符`,
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
        default_size: body.default_size as string,
      }),
      ...(body.default_format !== undefined && {
        default_format: pickNullableString(body.default_format) as string | null,
      }),
      ...(body.default_aspect_ratio !== undefined && {
        default_aspect_ratio: body.default_aspect_ratio as string,
      }),
      ...(body.default_duration !== undefined && {
        default_duration: pickNullableDuration(body.default_duration) as
          | number
          | null,
      }),
      ...(body.features !== undefined && { features: body.features }),
      ...(body.enabled !== undefined && { enabled: body.enabled as boolean }),
      ...(body.sort_order !== undefined && {
        sort_order: body.sort_order as number,
      }),
    },
  };
}
