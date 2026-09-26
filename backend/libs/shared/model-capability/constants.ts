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
// 像素表的键/值解析与消费侧共用同一对纯函数——写闸门和 `resolveOutputPixels` 各写一套
// 就会出现「存得进去、跑起来查不到」的漂移（ADR-0110 禁止的跨层重复口径）。
import { parsePixels, parseSpecKey } from "@lib/contracts";

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
  /** 渠道（封闭枚举，见 `image-channel-parser.ts` 的 `CHANNELS`）。**解析与出站的唯一来源**。
   *  新建恒能定下来（`capability_type` 已校验）；可空只为与 diff 提交的取值形状统一。 */
  channel?: ChannelId;
  request_mapping?: unknown;
  /** 计价规则；形态见 {@link pricingFieldErr}。 */
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
  /** 渠道；见 {@link ModelCreatePayload.channel}。`undefined` = 本次不写（渠道定不下来时）。 */
  channel?: ChannelId;
  request_mapping?: unknown;
  /** 计价规则；`undefined` = 不改，`null` = 清空。形态见 {@link pricingFieldErr}。 */
  pricing?: unknown | null;
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
  // 视频输出像素表：`"resolution=480p|aspect_ratio=16:9" → "864x496"`。
  // 只在**预扣**用（估 token）。键/值形态在这里钉死——读侧是宽容降级（查不到当未配），
  // 所以脏值一旦落库，表现是「预扣算不出上限 → 提交被拒」，而不是一条能看懂的报错。
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

/** `baseUnit` 允许的取值 —— 与 billing 的 `UsageDim` 枚举键一一对应。
 *
 *  表写在这里而不是从别处 import：billing 是 Java，跨语言没有共享常量源。
 *  ⚠️ 新增维度时**两边都要改**；漏了这边的表现是「存得进去、Hold 时编译不过（拒单）」。
 *  这个方向是安全的（fail-closed），反过来才是灾难。 */
const PRICING_BASE_UNITS = new Set([
  "constant:1",
  "usage.succeededSlots",
  "usage.seconds",
  "usage.characters",
  "usage.referenceCount",
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

/** 取整策略；缺省 `halfUp`（与 billing 的 `RoundingPolicy` 一致）。 */
const PRICING_ROUNDINGS = new Set(["halfUp", "ceil", "floor"]);

/** `basePrice.kind` 的封闭取值。`unset` = 「单价待配」的合法空位（提交会被拒，不会按 0 免费）。 */
const PRICING_KINDS = new Set(["const", "table", "unset"]);

/** `tokenEstimate` 的**封闭键集**（与 billing `CatalogDocument.TokenEstimate` 的记录字段一一对应）。
 *
 *  <p>写在这里而不是 import：billing 是 Java，跨语言没有共享常量源。多这一道校验就多一道
 *  「没人读的键存不进去」的闸门——`dimensions` 正是这么留下来的：像素搬进能力行的
 *  `features.video_dimensions` 之后，规则里那份**没有任何读方**，却会跟着规则快照冻进
 *  每一条预留行（实测库里 5 条视频规则的 `tokenEstimate` 里都还挂着它）。 */
const TOKEN_ESTIMATE_KEYS = new Set(["divisor", "fps", "inputSecondsKey", "minimumTokens"]);

/** 计价规则（`pricing` 列）的**结构**闸门。
 *
 *  <p>这是第一道。第二道在 billing：Hold 时用 `CatalogCompiler` 编译这份规则，
 *  编译不过就拒单（UNPRICEABLE）——**fail-closed，不是静默错价**。两道都留，因为它们拦的
 *  不是同一件事：这里拦「脏配置存不进去」（保存时就能告诉运营哪错了），
 *  那里拦「脏配置已经在库里了」（可能来自直接改库、或本闸门漏掉的形态）。
 *
 *  <p>⚠️ 这里**只校结构**，不校语义等价（例如 table 的键规范化后是否重复）——
 *  那需要在 TS 里再写一遍 billing 的键规范化规则，两份规则一定会漂（ADR-0110 禁止的跨层重复）。
 *  语义那份交给 billing 编译期；这里漏放过去的，那边会拒。
 *
 *  <p>**渠道决定的形状**（本函数末段）：渠道回答「这条规则该有哪些字段」，
 *  与「这条规则算出来的钱对不对」无关——**引擎与计算器一行没动**，所以现有每一次计价的
 *  金额不可能因为这道闸门而改变。 */
function pricingFieldErr(pricing: unknown, channel?: ChannelId): string | null {
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
  if (kind === "const" && typeof price.value !== "number") {
    return "计价规则(pricing).basePrice.kind=const 时必须给数值 value";
  }
  if (kind === "table") {
    if (!isPlainObject(price.table) || Object.keys(price.table).length === 0) {
      return "计价规则(pricing).basePrice.kind=table 时必须给非空 table";
    }
  }

  const denom = pricing.unitDenominator;
  if (denom !== undefined && denom !== null) {
    if (typeof denom !== "number" || !Number.isInteger(denom) || denom <= 0) {
      return "计价规则(pricing).unitDenominator 须为正整数（1 = 每秒/每张，1000000 = 每百万 token）";
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
    for (const axis of Object.keys(v)) {
      if (!PRICING_BASE_UNITS.has(axis)) {
        return `计价规则(pricing).${key} 的键须为基准维度，实为「${axis}」`;
      }
    }
  }

  /* ── dimPrices：按维度的**绝对**加价（`{ "<维度>": { unitMc, firstFree? } }`）─────────────
   * 它回答「这个维度每个单位固定多少钱」，**不乘 basePrice**。存在的理由：`dims` 是相对量
   * （金额 = 万分比 × basePrice），对单价分档的规则表达不了固定单价 —— Seedream 5.0 Pro
   * 的输出图分 0.3/0.6 两档，而参考图「每张 0.02 元」在两档下必须是同一个数。 */
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
      // 不接受 0：0 等于「这个维度免费」，而免费应当由「不写这个维度」表达 ——
      // 写一个 0 出来，读的人只会当成配漏了。billing 编译期也拒（两道闸门同一口径）。
      if (typeof unitMc !== "number" || !Number.isInteger(unitMc) || unitMc <= 0) {
        return `计价规则(pricing).dimPrices.${axis}.unitMc 须为正整数（单位是 mc，与 basePrice.value 相同：`
          + "1 积分 = 1000 mc。要让这个维度不计费，请整块删掉它，别写 0）";
      }
      if (spec.firstFree !== undefined && spec.firstFree !== null
          && typeof spec.firstFree !== "boolean") {
        return `计价规则(pricing).dimPrices.${axis}.firstFree 须为布尔（缺省 = 不免费）`;
      }
    }
    // ⚠️ **与 maxCredits 互斥**。上限计价（`capDetailed`）跳过用量计算，算不到这份绝对加价 ⇒
    //    预扣冻的是一份**不含加价**的上限，而结算会把它算进去 ⇒ 超出部分记应收（少收且静默：
    //    只有一条 WARN，账面上看不出原因）。billing 的 CompiledRule 构造也拒这一条，这里是第一道。
    if (typeof pricing.maxCredits === "number") {
      return "计价规则(pricing).dimPrices 与 maxCredits 不能同时配："
        + "上限计价跳过用量计算、算不到维度绝对加价，预扣会冻结一份不含加价的额度，"
        + "结算超出后只记应收（少收且静默）。二选一";
    }
  }

  const est = pricing.tokenEstimate;
  if (est !== undefined && est !== null) {
    if (!isPlainObject(est)) return "计价规则(pricing).tokenEstimate 须为 JSON 对象";
    for (const key of Object.keys(est)) {
      if (!TOKEN_ESTIMATE_KEYS.has(key)) {
        return `计价规则(pricing).tokenEstimate 不认识这个键：「${key}」`
          + `（只收 ${[...TOKEN_ESTIMATE_KEYS].join(" / ")}）。`
          + "已退役的键（如 dimensions —— 像素已搬进本行的 features.video_dimensions）请删掉";
      }
    }
    for (const key of ["divisor", "fps"] as const) {
      const v = est[key];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        return `计价规则(pricing).tokenEstimate.${key} 必填且为正整数`;
      }
    }
    const secKey = est.inputSecondsKey;
    if (secKey !== undefined && secKey !== null) {
      if (typeof secKey !== "string" || secKey.trim().length === 0) {
        return "计价规则(pricing).tokenEstimate.inputSecondsKey 不能是空白串"
          + "（要「不加输入时长那一项」就整个别写这个字段）";
      }
    }
  }

  /* ── 渠道决定的形状 ──────────────────────────────────────────────────────────
   * 渠道回答「这条规则**该有哪些字段**」。它**不进** `baseUnit` / `dims` / `multipliers` /
   * `basePrice`，也不进 Hold 请求与 `CompiledRule` —— 所以它改变不了任何一次计价的输入集合，
   * 也就改变不了金额（这是「按渠道收窄」敢做的前提）。
   *
   * ⚠️ `channel` 未知（历史行 / 未迁移行 / 调用方没传）时**整段跳过**：这条闸门的产物是
   * 「保存被拒」，而一个拿不到渠道的调用方不该因此拦下运营的正常编辑。 */
  if (channel !== undefined) {
    // `tokenEstimate` 是「按帧 × 像素估 token」的**预扣**公式参数。只有视频媒介有这个形态
    // （它的基准维度是 usage.c，而提交时刻没有真实 token）；配在别的渠道上是一条没人读的
    // 配置 —— 界面看不出异常，而运营以为配了。
    if (est != null && channelOf(channel).media !== "video") {
      return `计价规则(pricing).tokenEstimate 只在视频渠道上成立（当前渠道「${channel}」不按 token 估算）；`
        + "留着它等于一条没人读的配置，请整块删掉";
    }
    // 分母 `≠ 1` 只在「每百万 token」这个口径下有意义（`unitDenominator` 就是为它存在的）。
    // 「每张 / 每次 / 每秒」的分母恒为 1；写成 1000000 会把单价缩小一百万倍。
    const denom = pricing.unitDenominator;
    if (typeof denom === "number" && denom !== 1 && est == null) {
      return "计价规则(pricing).unitDenominator ≠ 1 必须与 tokenEstimate 同时出现"
        + "（分母是「每多少个单位收这份单价」，只有按 token 的规则才不是 1）";
    }
    // ⚠️ **按秒计价的音频必须配 maxCredits** —— 这不是调优，是这条规则能不能用的前提。
    //
    //    `usage.seconds` 的契约量来自规格键 `duration`，而 Seed Audio 是 TTS 式接口：
    //    时长由文案决定，请求里**根本没有 duration**（见 002_seed.sql 的 IKG4UR 注，
    //    `supported_durations` 也是 NULL）。billing 的 `Usage.contractFrom` 对此的立场是
    //    「拒绝，而不是按 0 冻」——只有规则配了上限，才转成
    //    「按上限冻结、结算按实际时长重算」（`BillingApplicationService#priceAtCap`）。
    //
    //    所以漏配 `maxCredits` 的表现不是「少收」，而是**这个模型每一次提交都被拒**
    //    （UNPRICEABLE 400）——运营看到的是「音频功能坏了」，而根因藏在一段 JSON 里。
    //    宁可在这里当场拦住并说清楚。
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
  /** 判计价形状用（含库中那一行）；`channel` 只表示「本次要不要写这一列」。 */
  effectiveChannel?: ChannelId;
  request_mapping?: unknown;
}> {
  if (body.channel !== undefined && !isChannelId(body.channel)) {
    return { ok: false, error: `渠道(channel)只支持 ${CHANNEL_IDS.join(" / ")}` };
  }
  const explicit = isChannelId(body.channel) ? body.channel : null;
  // 显式提交的取值**必须判得了媒介**，且媒体必须与行的类型一致。漏了这道闸，一个视频行
  // 可以配成 `gpt-image`，而 video 链路根本不读渠道——存得进去、跑起来照旧，界面上看不出异常。
  if (explicit !== null) {
    const channelErr = validateChannel(explicit, capabilityType);
    if (channelErr) return { ok: false, error: channelErr };
  }
  // 库里那一行：update 是 diff 提交，没改过的渠道不在 body 里，必须回落到**库中该行**——
  // 否则下面整段映射校验会按错误的解析器跑，GPT 行删空矩阵、Seedream 行映射表被清空
  // 都是从这条缝漏过去的。
  const stored = mode === "update" && isChannelId(current?.channel) ? current.channel : null;
  // 新建恒能定下来（`capability_type` 在上面已校验）；更新只在**显式提交**时写——
  // 没提交就整列不动，与其他 diff 字段同一条规矩（写回去只会是恒等的）。
  const channel: ChannelId | null = explicit ?? (mode === "create" ? defaultChannelFor(capabilityType) : null);
  // 解析器的唯一来源是渠道（非图片渠道取 `seedream`）；渠道定不下来时回落 `seedream`，
  // 与改造前「拿不到 current 就按 seedream 校验」的口径逐字一致。
  /** 判计价形状用的渠道：本次没提交就用**库里那一行**的。
   *  ⚠️ 这里不能直接用 `channel`（更新未提交时为 null）——否则「按渠道收窄计价配置」这条
   *  闸门在**前端不改渠道时**（绝大多数保存）根本不跑，等于没有。 */
  const effectiveChannel = channel ?? stored;
  const parser: ImageChannelParserId =
    channel !== null ? channelOf(channel).parser ?? "seedream"
    : stored !== null ? channelOf(stored).parser ?? "seedream"
    : "seedream";


  // Seedream 行的映射表是 IK629 之后尺寸换算的唯一来源（worker-java hasSizeMatrix
  // 判假即回退成「直传 provider size」，而那正是 024 迁移要修的 400 Invalid size）。
  // 后台没有「清空矩阵」入口，所以对一个**本来就是 seedream** 的行，客户端传的 null
  // 不是运营意图、是 diff 提交的产物——按「不改」处理。
  //
  // 但「本来不是 seedream」的行不能这么办：把 gpt 行切到 seedream 时，前端同样只发
  // null，而那个 null 就是「gpt 的矩阵不再适用」的唯一表达。当成「不改」会把上一族的
  // 矩阵留在行里，worker 拿它去算 seedream 的尺寸，而界面上没有任何入口能再清掉它。
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
  // 显式声明切到 gpt / banana 时必须同时给出映射表——否则切完是一张空表，
  // 该模型每次请求都 empty_mapping。缺省不传 channel 时表示「不改」，
  // 那一行的映射表原样留在库里，由上面的 stored 兜底校验。
  if (explicit !== null && parser !== "seedream" && !mappingProvided) {
    return { ok: false, error: "request_mapping 不能为空" };
  }
  if (mappingProvided) {
    // ⚠️ 档位清单（supported_sizes）也是 diff 提交：没改过的尺寸不在 body 里。seedream 的
    //    矩阵键校验要拿它当**合法键集合**，所以与 channel 同一套回落 —— 用库中那一行。
    //    （少了这一步，一次「只改矩阵」的保存会因为拿不到档位而跳过校验，闸门形同虚设。）
    const sizesForGate = body.supported_sizes ?? current?.supported_sizes;
    const mappingErr = validateRequestMapping(parser, body.request_mapping, sizesForGate);
    if (mappingErr) return { ok: false, error: mappingErr };
  }
  return {
    ok: true,
    value: {
      // 新建恒写（按媒介取缺省）；更新只在显式提交时写。
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

  const parsedMapping = parseChannelAndMapping(body, "create", body.capability_type);
  if (!parsedMapping.ok) return parsedMapping;
  // 计价规则的形状按**渠道**收窄（见 pricingFieldErr 末段）。渠道先解析、再判价。
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

/** 校验管理端「更新模型」请求体。
 *
 *  `current` 是**库中当前那一行**（至少 `channel` 与 `capability_type`）。更新是 diff 提交，
 *  未变更的字段不在请求体里，光看 body 推不出该用哪个渠道做映射校验——必须由调用方把行读出来
 *  传进来。调用方须读库，**不得读缓存**：校验读到旧值等于没校验。 */
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
  const parsedMapping = parseChannelAndMapping(body, "update", current?.capability_type, current);
  if (!parsedMapping.ok) return parsedMapping;
  // 与 create 同序：先定渠道，再按渠道判计价规则的形状。
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
