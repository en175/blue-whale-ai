
export const IMAGE_CHANNEL_PARSERS = ["seedream", "gpt", "banana"] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];

export const IMAGE_PROTOCOLS = ["inline-image", "openai-images"] as const;
export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];

export const CHANNEL_MEDIA = ["image", "video", "audio", "text"] as const;
export type ChannelMedia = (typeof CHANNEL_MEDIA)[number];

export interface ChannelSpec {
  readonly id: string;
  readonly media: ChannelMedia;
  readonly parser: ImageChannelParserId | null;
  readonly protocol: ImageProtocol | null;
}

export const CHANNELS = [
  { id: "seedream-image", media: "image", parser: "seedream", protocol: "inline-image" },
  { id: "gpt-image", media: "image", parser: "gpt", protocol: "inline-image" },
  { id: "gpt-image-openai", media: "image", parser: "gpt", protocol: "openai-images" },
  { id: "banana-image", media: "image", parser: "banana", protocol: "inline-image" },
  { id: "seedream-video", media: "video", parser: null, protocol: null },
  { id: "seedream-audio", media: "audio", parser: null, protocol: null },
  { id: "seedream-text", media: "text", parser: null, protocol: null },
] as const satisfies readonly ChannelSpec[];

export type ChannelId = (typeof CHANNELS)[number]["id"];

export const CHANNEL_IDS = CHANNELS.map((channel) => channel.id);

export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && CHANNELS.some((channel) => channel.id === value);
}

export function channelOf(id: ChannelId): ChannelSpec {
  return CHANNELS.find((channel) => channel.id === id) ?? CHANNELS[0];
}

export function defaultChannelFor(capabilityType: unknown): ChannelId {
  switch (capabilityType) {
    case "video":
      return "seedream-video";
    case "audio":
      return "seedream-audio";
    case "text":
      return "seedream-text";
    default:
      return "seedream-image";
  }
}

export function parseStoredChannel(raw: unknown, capabilityType: unknown): ChannelId {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (isChannelId(normalized)) return normalized;
  }
  return defaultChannelFor(capabilityType);
}

export function validateChannel(channel: unknown, capabilityType: unknown): string | null {
  if (!isChannelId(channel)) {
    return `渠道(channel)只支持 ${CHANNEL_IDS.join(" / ")}`;
  }
  if (!isChannelMedia(capabilityType)) {
    return `渠道(channel)无法校验：行的类型(capability_type)缺失或不认识（${String(capabilityType)}）`;
  }
  const spec = channelOf(channel);
  if (spec.media !== capabilityType) {
    return `渠道「${channel}」是 ${spec.media} 的，不能配在 ${capabilityType} 类型的行上`;
  }
  return null;
}

export function isChannelMedia(value: unknown): value is ChannelMedia {
  return typeof value === "string" && (CHANNEL_MEDIA as readonly string[]).includes(value);
}

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

function seedreamMappingErr(mapping: unknown, sizes: unknown): string | null {
  if (mapping === null || mapping === undefined) return null;
  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    return "seedream request_mapping 须为 JSON 对象";
  }
  const matrix = (mapping as { matrix?: unknown }).matrix;
  if (matrix === null || matrix === undefined) return null;
  if (typeof matrix !== "object" || Array.isArray(matrix)) {
    return "seedream request_mapping.matrix 须为对象";
  }
  const allowed = seedreamSizeKeys(sizes);
  if (allowed === null || allowed.size === 0) return null;
  for (const [key, row] of Object.entries(matrix as Record<string, unknown>)) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return `seedream 交叉格每一行须为对象：${key}`;
    }
    if (allowed.has(key.trim().toLowerCase())) continue;
    return `seedream 矩阵的键必须是该档位的 api_value（或 id）：${key} 不在 [${[...allowed].join(" / ")}] 里`;
  }
  return null;
}

function seedreamSizeKeys(sizes: unknown): Set<string> | null {
  if (!Array.isArray(sizes)) return null;
  const keys = new Set<string>();
  for (const item of sizes) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    for (const raw of [o.api_value, o.apiValue, o.id]) {
      if (typeof raw === "string" && raw.trim()) keys.add(raw.trim().toLowerCase());
    }
  }
  return keys.size ? keys : null;
}

export interface RatioOption {
  id: string;
  label: string;
}

export function availableAspectRatiosForSize(
  mapping: ImageRequestMapping,
  sizeOptionId: string,
  configuredRatios: readonly RatioOption[],
): RatioOption[] {
  if (mapping.parser === "banana") {
    if (!filled(lookupIgnoreCase(mapping.quality, sizeOptionId))) return [];
    return configuredRatios.filter((ratio) =>
      filled(lookupIgnoreCase(mapping.size, ratio.id)),
    );
  }
  if (mapping.parser !== "gpt") {
    return [...configuredRatios];
  }
  return configuredRatios.filter((ratio) =>
    filled(lookupMatrixCell(mapping.matrix, sizeOptionId, ratio.id)),
  );
}

export function validateRequestMapping(
  parser: ImageChannelParserId,
  mapping: unknown,
  sizes?: unknown,
): string | null {
  if (parser === "seedream") return seedreamMappingErr(mapping, sizes);
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
    let filledCells = 0;
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
        filledCells += 1;
      }
    }
    if (filledCells === 0) {
      return "gpt 交叉格不能全为空：至少填一格，否则该模型的所有请求都会失败";
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
  let qualityFilled = false;
  let sizeFilled = false;
  for (const [name, map] of [
    ["quality", record.quality],
    ["size", record.size],
  ] as [string, Record<string, unknown>][]) {
    for (const value of Object.values(map)) {
      if (value == null || value === "") continue;
      if (typeof value !== "string") return "banana 映射值须为字符串";
      if (!filled(value)) continue;
      if (name === "quality") qualityFilled = true;
      else sizeFilled = true;
    }
  }
  if (!qualityFilled || !sizeFilled) {
    return "banana 映射表 quality / size 至少各填一项，否则该模型的所有请求都会失败";
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
