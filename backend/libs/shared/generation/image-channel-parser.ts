/** 图片生成渠道解析器：从能力行目录映射 GPT / banana 请求字段。
 *  Seedream 不走本模块查表，仍由 seedream-image-size 代码表计算。 */

export const IMAGE_CHANNEL_PARSERS = ["seedream", "gpt", "banana"] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];

export const GPT_PROVIDER_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
  "2048x1360",
  "1360x2048",
  "1152x2048",
  "2048x1536",
  "1536x2048",
  "2048x880",
  "880x2048",
  "688x2048",
  "2048x688",
  "2048x1024",
  "1024x2048",
  "auto",
] as const;

export type GptProviderSize = (typeof GPT_PROVIDER_SIZES)[number];

export type ImageRequestMapping =
  | { parser: "seedream" }
  | {
      parser: "gpt";
      matrix: Readonly<Record<string, Readonly<Record<string, string>>>>;
      defaultSizeId: string;
      defaultRatioId: string;
    }
  | {
      parser: "banana";
      quality: Readonly<Record<string, string>>;
      size: Readonly<Record<string, string>>;
      defaultSizeId: string;
      defaultRatioId: string;
    };

export type MappedImageRequest =
  | { ok: true; size: string; quality?: string }
  | { ok: false; code: "empty_mapping" };

function filled(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function lookupIgnoreCase(
  record: Readonly<Record<string, string>> | undefined,
  key: string | null,
): string | undefined {
  if (!record || key == null || key.length === 0) return undefined;
  if (filled(record[key])) return record[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower && filled(v)) return v;
  }
  return undefined;
}

function lookupMatrixCell(
  matrix: Readonly<Record<string, Readonly<Record<string, string>>>>,
  sizeId: string | null,
  ratioId: string | null,
): string | undefined {
  if (sizeId == null || ratioId == null) return undefined;
  const row = matrix[sizeId] ?? matrix[sizeId.toLowerCase()];
  if (!row) {
    const lower = sizeId.toLowerCase();
    for (const [k, v] of Object.entries(matrix)) {
      if (k.toLowerCase() === lower) {
        return lookupIgnoreCase(v, ratioId);
      }
    }
    return undefined;
  }
  return lookupIgnoreCase(row, ratioId);
}

export function isImageChannelParserId(
  value: unknown,
): value is ImageChannelParserId {
  return (
    typeof value === "string" &&
    (IMAGE_CHANNEL_PARSERS as readonly string[]).includes(value)
  );
}

export function isGptProviderSize(value: string): value is GptProviderSize {
  return (GPT_PROVIDER_SIZES as readonly string[]).includes(value);
}

export function mapImageChannelRequest(
  mapping: ImageRequestMapping,
  sizeOptionId: string | null,
  ratioId: string | null,
): MappedImageRequest {
  if (mapping.parser === "seedream") {
    return { ok: false, code: "empty_mapping" };
  }
  if (mapping.parser === "gpt") {
    const cell = lookupMatrixCell(mapping.matrix, sizeOptionId, ratioId);
    if (filled(cell)) return { ok: true, size: cell };
    const fallback = lookupMatrixCell(
      mapping.matrix,
      mapping.defaultSizeId,
      mapping.defaultRatioId,
    );
    if (filled(fallback)) return { ok: true, size: fallback };
    return { ok: false, code: "empty_mapping" };
  }
  const quality =
    lookupIgnoreCase(mapping.quality, sizeOptionId) ??
    lookupIgnoreCase(mapping.quality, mapping.defaultSizeId);
  const size =
    lookupIgnoreCase(mapping.size, ratioId) ??
    lookupIgnoreCase(mapping.size, mapping.defaultRatioId);
  if (!filled(quality) || !filled(size)) {
    return { ok: false, code: "empty_mapping" };
  }
  return { ok: true, size, quality };
}

export function availableAspectRatiosForSize(
  mapping: ImageRequestMapping,
  sizeOptionId: string,
  configuredRatios: readonly string[],
): string[] {
  if (mapping.parser === "banana") {
    if (!filled(lookupIgnoreCase(mapping.quality, sizeOptionId))) return [];
    return configuredRatios.filter((ratio) =>
      filled(lookupIgnoreCase(mapping.size, ratio)),
    );
  }
  if (mapping.parser !== "gpt") {
    return [...configuredRatios];
  }
  return configuredRatios.filter((ratio) =>
    filled(lookupMatrixCell(mapping.matrix, sizeOptionId, ratio)),
  );
}

export function validateRequestMapping(
  parser: ImageChannelParserId,
  mapping: unknown,
): string | null {
  if (parser === "seedream") return null;
  if (mapping == null) return "request_mapping 不能为空";
  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    return "request_mapping 须为 JSON 对象";
  }
  const record = mapping as Record<string, unknown>;
  if (parser === "gpt") {
    if (
      record.matrix == null ||
      typeof record.matrix !== "object" ||
      Array.isArray(record.matrix)
    ) {
      return "gpt request_mapping.matrix 须为对象";
    }
    for (const row of Object.values(
      record.matrix as Record<string, unknown>,
    )) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) {
        return "gpt 交叉格每一行须为对象";
      }
      for (const cell of Object.values(row as Record<string, unknown>)) {
        if (cell == null || cell === "") continue;
        if (typeof cell !== "string" || !isGptProviderSize(cell)) {
          return `gpt 交叉格只能填官方 size 枚举或留空：${String(cell)}`;
        }
      }
    }
    return null;
  }
  if (
    record.quality == null ||
    typeof record.quality !== "object" ||
    Array.isArray(record.quality)
  ) {
    return "banana request_mapping.quality 须为对象";
  }
  if (
    record.size == null ||
    typeof record.size !== "object" ||
    Array.isArray(record.size)
  ) {
    return "banana request_mapping.size 须为对象";
  }
  for (const map of [record.quality, record.size] as Record<string, unknown>[]) {
    for (const value of Object.values(map)) {
      if (value == null || value === "") continue;
      if (typeof value !== "string") return "banana 映射值须为字符串";
    }
  }
  return null;
}

export function parseStoredImageRequestMapping(
  parser: unknown,
  mapping: unknown,
  defaults: { sizeId: string; ratioId: string },
): ImageRequestMapping {
  const id = isImageChannelParserId(parser) ? parser : "seedream";
  if (id === "seedream") return { parser: "seedream" };
  const record =
    mapping && typeof mapping === "object" && !Array.isArray(mapping)
      ? (mapping as Record<string, unknown>)
      : {};
  if (id === "gpt") {
    const matrix =
      record.matrix && typeof record.matrix === "object" && !Array.isArray(record.matrix)
        ? (record.matrix as Record<string, Record<string, string>>)
        : {};
    return {
      parser: "gpt",
      matrix,
      defaultSizeId: defaults.sizeId,
      defaultRatioId: defaults.ratioId,
    };
  }
  const quality =
    record.quality && typeof record.quality === "object" && !Array.isArray(record.quality)
      ? (record.quality as Record<string, string>)
      : {};
  const size =
    record.size && typeof record.size === "object" && !Array.isArray(record.size)
      ? (record.size as Record<string, string>)
      : {};
  return {
    parser: "banana",
    quality,
    size,
    defaultSizeId: defaults.sizeId,
    defaultRatioId: defaults.ratioId,
  };
}
