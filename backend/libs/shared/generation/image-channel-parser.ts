/** 渠道解析：一个模型走哪个渠道，渠道决定请求怎么解析、出站用哪种线协议。
 *
 *  <p>本模块现在是**渠道表的单一事实源**（{@link CHANNELS}）＋它派生出的解析算术。
 *  Seedream 不走映射查表——尺寸由能力行 `request_mapping.matrix` 承载（IK629：原代码表
 *  seedream-image-size.ts 已删，见 worker ImageChannelMapper.resolveSeedreamSize）。 */

export const IMAGE_CHANNEL_PARSERS = ["seedream", "gpt", "banana"] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];

/** 出站线协议（原 `features.image_protocol`）。缺省 `inline-image`——未声明的图片行行为不变。 */
export const IMAGE_PROTOCOLS = ["inline-image", "openai-images"] as const;
export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];

/* ── 渠道表 ────────────────────────────────────────────────────────────────────
 *
 * 元素 `{id, media, parser, protocol}`：**`id` 就是库里 `channel` 列的字面值**，
 * 加渠道 = 往这张表加一条，别处不新增分支（对账测试钉住两端集合相等）。
 *
 * <h2>为什么合成一列，而不是「解析器 + 协议」两个字段</h2>
 *
 * 原先它们是两个字段两个形态：`channel_parser`（**列**：seedream / gpt / banana，请求字段
 * 怎么映射）× `features.image_protocol`（**JSON 键**：内联 / 官方 openai images，出站怎么发）。
 * 于是「同一个渠道」被拆成两半，运营在界面上看到两个像重复的控件，而「解析器 → 读
 * `request_mapping` 哪一部分」这层映射在两个语言里被写了多遍。
 *
 * <p>⚠️ **换协议 = 新渠道**（用户口径：「通渠道换协议，就做成新渠道」）。`gpt-image`（内联）
 * 与 `gpt-image-openai`（官方协议）是**两个渠道**，不是同一个渠道的两个开关 —— 否则就退化回
 * 「两个字段自由组合」，能配出 `parser=banana × openai-images` 这种必然 400 的组合
 * （官方协议只认 low/medium/high/auto，banana 会把 `1k` 原样发出去）。
 *
 * <h2>为什么非图片媒介也要有渠道</h2>
 *
 * 用户口径：「视频也可以用 seedream-video 这种」。video / audio / text 行上，`channel_parser`
 * 一直是个**无意义的默认值** —— 渠道就是媒介本身，没有解析器与协议之分。给它们一个渠道取值，
 * 「一个模型一个渠道」这条不变量才对所有行成立，读侧也就不用再按类型分叉。
 *
 * <p>⚠️ **非图片渠道的 `parser` / `protocol` 必须是 `null`**（对账测试机械保证）。
 * 否则将来一定有人给视频行配一张「映射表」，而 video 链路根本不读它 —— 配了等于没配，
 * 界面上还看不出来。
 *
 * <p>⚠️ 表名不是 `IMAGE_CHANNELS`：它现在含 video / audio / text，叫 IMAGE_ 是撒谎。 */
export const CHANNEL_MEDIA = ["image", "video", "audio", "text"] as const;
export type ChannelMedia = (typeof CHANNEL_MEDIA)[number];

export interface ChannelSpec {
  readonly id: string;
  readonly media: ChannelMedia;
  /** 请求字段的映射策略；非图片媒介为 `null`（它们的请求不做映射）。 */
  readonly parser: ImageChannelParserId | null;
  /** 出站线协议；非图片媒介为 `null`。 */
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

/** 唯一「认不认这个取值」的判定点 —— 写闸门与读侧共用，别处不要再写一份成员判断。 */
export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && CHANNELS.some((channel) => channel.id === value);
}

/** 渠道 → 完整定义。`?? CHANNELS[0]` 只为消掉 `.find` 的 `undefined`：
 *  {@link ChannelId} 就是本表 id 的联合，查不到在类型上不可达。 */
export function channelOf(id: ChannelId): ChannelSpec {
  return CHANNELS.find((channel) => channel.id === id) ?? CHANNELS[0];
}

/** 该媒介的缺省渠道：**新建**行（还没提交渠道）与该写缺省时的取值。
 *
 *  <p>**按媒介分**而不是恒回落 `seedream-image` —— 一个 video 行若落成 `seedream-image`，
 *  媒体闸门会在下一次保存时把它判成非法，而运营什么都没改。 */
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

/** 库里 `channel` 原始值 → 渠道。
 *
 *  <p>读侧宽容：空值/认不出的取值都按 {@link defaultChannelFor} 回落。列是 NOT NULL，
 *  所以这不是为存量兜底，而是**防御直接改库/手写 INSERT 造出的脏值**——读侧不该因为
 *  一行脏数据整条链路抛错。**归一（trim + 小写）只用于比对，不写回**。 */
export function parseStoredChannel(raw: unknown, capabilityType: unknown): ChannelId {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (isChannelId(normalized)) return normalized;
  }
  return defaultChannelFor(capabilityType);
}

/** 写侧形态闸门：取值必须是本表的 id，且**媒体必须与该行的 `capability_type` 一致**。
 *
 *  <p>媒体一致性是这条闸门的主要价值：漏了它，一个视频行可以配成 `gpt-image`，
 *  而 video 链路根本不读渠道 —— 存得进去、跑起来照旧，界面上看不出任何异常。 */
export function validateChannel(channel: unknown, capabilityType: unknown): string | null {
  if (!isChannelId(channel)) {
    return `渠道(channel)只支持 ${CHANNEL_IDS.join(" / ")}`;
  }
  if (!isChannelMedia(capabilityType)) {
    // 判不了就拒绝，不静默放行：调用方（写闸门）总是拿得到已校验的 capability_type，
    // 拿不到说明少传了参数，静默通过只会让这条闸门形同虚设。
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

/**
 * seedream 的映射表校验：矩阵的**键必须等于某个档位的 `api_value`**（没有 api_value 时回落 id）。
 *
 * <h2>为什么必须在这里拦</h2>
 *
 * worker 的查找链是「按 id（或 api_value）命中 `supported_sizes` 条目 → 取该条目的
 * `api_value` 当 providerSize → **再用它当矩阵查找键**」（`ImageChannelMapper.matchSupportedSize`
 * / `resolveSeedreamSize`）。所以键写成别的拼写，这一档的出站尺寸就解不出来 ——
 * 上游回 `400 Invalid size`，而界面上看不出任何异常。
 *
 * <h2>它此前是完全不校验的</h2>
 *
 * 本函数原先对 seedream 直接 `return null`（「seedream 不吃矩阵」时代的遗留）。实测已经漏过
 * 一次：`doubao-seedream-5-0-pro-260628` 的矩阵键是 `1k` / `2` / `1.5`，而它的档位 id 是
 * `1k` / `1.5k` / `2k` —— `2` 与 `1.5` 既不是 id 也不是 api_value，是两次迁移之间的陈旧拼写，
 * 于是 1.5K / 2K 两档的尺寸都解不出来。
 *
 * 按 [ADR-0110](../../../../docs/adr/0110-model-capability-config-is-authoritative.md)：
 * **不许为运营误配写运行时兜底**（那会让「配错了会怎样」再也没人验证），
 * 运营误配由**写侧闸门 + 后台表单**负责 —— 这就是那道闸门（表单侧见
 * `web/src/admin/pages/ModelList/model-form.ts` 的 `seedreamWireMatrix`）。
 *
 * <p>⚠️ **只校验键的归属，不要求全覆盖**：少一档的后果是「那一档解不出尺寸」，
 * 与写错键是同一类；但要求全覆盖会让「先加档位、后补矩阵」的正常编辑顺序保存不了。
 * 空缺由「配了就必须配全」留待后续单独决定（见工单遗留）。
 *
 * @param sizes 该行的 `supported_sizes`（画布/DB 的原始 JSON）；拿不到时**跳过**键校验
 *              —— 宁可不查，也不拿「未知」当「没有档位」把正常保存拦死
 */
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

/**
 * 该行档位的合法矩阵键（api_value 优先，回落 id），全部小写。
 *
 * @returns `null` = 拿不到 `supported_sizes`（不校验）
 */
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
    // 全空的矩阵落库后，mapImageChannelRequest 恒返回 empty_mapping，
    // 该模型此后每一次请求都 400 —— 与其让线上炸，不如在写入时拦住。
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
      // 运行期用 filled()（trim 判定）认空，这里必须同口径——
      // 否则 {"1k": "  "} 能过闸门，请求期却恒 empty_mapping。
      if (!filled(value)) continue;
      if (name === "quality") qualityFilled = true;
      else sizeFilled = true;
    }
  }
  // 同 gpt：quality / size 任一全空 ⇒ 每次请求都 empty_mapping。
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
