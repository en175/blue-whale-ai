import type { AdminModel, CreateAdminModelParams, DurationRange, ModelSize } from '@/api/adminModels';

export type ModelType = 'image' | 'video' | 'text' | 'audio';

/** IKHBDO：表单态尺寸行。库里 `supported_sizes` 元素除 id/label 外还带出站值与像素宽高
 *  （字段集见 backend `model-capability-repo.ts` 的 `SizeJson`），原先表单只认 id/label，
 *  保存时整包覆盖 → 这三个字段每次保存都被抹掉。宽高是**字符串**（空串 = 不写）。 */
export interface SizeForm {
  id: string;
  label?: string;
  /** 出站实际用到的档位值（如 `4k`）；留空时消费端回落用 id。 */
  apiValue?: string;
  /** 像素宽 / 高：**当前无任何消费方**（图片侧 worker 读了不用，视频侧零引用，见 IKHTVR）——
   *  表单不再显示这两列，但字段保留：库里已有的值原样读回、原样写回，保存不丢数据。 */
  width?: string;
  height?: string;
}

/** `supported_sizes` 元素：id/label 之外允许任意扩展字段（wire 形态）。 */
export type ModelSizeWire = ModelSize & Record<string, unknown>;

/** snake_case → camelCase。读侧（backend `toFeatures` / worker-java）两种键形都认，
 *  且**优先认 camelCase**——表单只认 snake_case 时，camel 行会显空白并让 camel 值继续生效。 */
export function camelFeatureKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** features 中由结构化控件承载的键：命中即不进「高级 JSON」，避免同一键两处各写一份。 */
export const KNOWN_FEATURE_KEYS = [
  'reference_image',
  'watermark',
  'stream',
  'sequential_image_generation',
  'first_frame',
  'last_frame',
  'first_last_frame',
  'audio',
  'video_reference',
  'audio_reference',
  'tools',
  'image_reference_max',
  'quantity_max',
  'max_prompt_length',
  'video_reference_max',
  'audio_reference_max',
  'max_reference_duration_sec',
  'i2i_model_name',
  /** ADR-0086：按任务类型的比例约束（`{default: {allowed_ratios: [...]}, …}`）。
   *  ⚠️ 此前**漏在这张表里**——`dropKnownFeatures` 里那段「对象键不进高级 JSON」的分支
   *  于是永远命中不了（判据是 `known === 'task_types'`，而 known 只能是这张表里的键）。
   *  后果：清空结构化控件里的全部 allowed_ratios 之后，高级 JSON 里那份旧 task_types
   *  会被原样写回去（「我删了」变成没删）。补上即修复，语义与那段分支的注释一致。 */
  'task_types',
  /** ADR-0086 的续：视频「档位 × 比例 → 输出像素」表（`resolution=480p|aspect_ratio=16:9`
   *  → `864x496`）。只在**预扣估 token** 用，键/值形态由后端写闸门钉死（见
   *  `backend/libs/contracts/capability-param-validation.ts` 的 `parseSpecKey` / `parsePixels`）。
   *  由结构化控件（候选键派生自本行的档位 × 比例）承载，不留给高级 JSON 手敲。 */
  'video_dimensions',
] as const;

/** ADR-0086：按任务类型的比例约束（`features.task_types`）。只有视频任务会带 task_type。 */
export const TASK_TYPE_KEYS = ['default', 'first_frame', 'first_last_frame', 'edit', 'prolong'] as const;
export type TaskTypeKey = (typeof TASK_TYPE_KEYS)[number];

export const TYPE_TABS: { key: ModelType; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'text', label: '文生文' },
  { key: 'audio', label: '音频' },
];

export const DEFAULT_PROVIDER_ID = 'new-api';

/** 请求字段怎么映射：渠道定义的一部分（见 `CHANNELS`）。 */
export const IMAGE_CHANNEL_PARSERS = ['seedream', 'gpt', 'banana'] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];

/** 出站线协议：渠道定义的一部分（见 `CHANNELS`）。 */
export const IMAGE_PROTOCOLS = ['inline-image', 'openai-images'] as const;
export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];

export const CHANNEL_MEDIA = ['image', 'video', 'audio', 'text'] as const;
export type ChannelMedia = (typeof CHANNEL_MEDIA)[number];

/**
 * 渠道 = 「这个模型走哪家、请求怎么解析、出站用哪种线协议」这**一件事**。
 *
 * <p>库里是能力行的 `channel` 列（封闭枚举）。加渠道 = 往这张表加一条，别处不新增分支。
 * 它与 backend 写闸门（`libs/shared/generation/image-channel-parser.ts`）和 worker-java
 * 的 `ImageChannel` 是**两份实现、一份契约**——跨语言没有共享常量源，靠
 * `channel-table-parity.test.ts` 逐条对账钉住，改一边不改另一边就是测试红。
 *
 * <p>⚠️ **换协议 = 新渠道**（`gpt-image` 内联 与 `gpt-image-openai` 官方协议是两条）。
 * 不给「解析器 + 协议」两个自由下拉：那样能配出根本不成立的组合
 * （`parser=banana` × `openai-images`——官方协议只认 low/medium/high/auto，
 * 而 banana 会把 `1k` 原样发出去 → 必然 400，且错误来自上游、离真正原因隔一层）。
 *
 * <p>本表比 backend 那份多一个 `label`（下拉要中文），其余四个字段逐条对齐。
 */
export interface ChannelOption {
  id: string;
  label: string;
  media: ChannelMedia;
  /** 请求字段的映射策略；非图片媒介为 `null`。 */
  parser: ImageChannelParserId | null;
  /** 出站线协议；非图片媒介为 `null`。 */
  protocol: ImageProtocol | null;
}

export const CHANNELS = [
  { id: 'seedream-image', label: 'Seedream 图片（内联）', media: 'image', parser: 'seedream', protocol: 'inline-image' },
  { id: 'gpt-image', label: 'GPT 图片（内联）', media: 'image', parser: 'gpt', protocol: 'inline-image' },
  { id: 'gpt-image-openai', label: 'GPT 图片（官方 openai images 协议）', media: 'image', parser: 'gpt', protocol: 'openai-images' },
  { id: 'banana-image', label: 'Banana 图片（内联）', media: 'image', parser: 'banana', protocol: 'inline-image' },
  { id: 'seedream-video', label: 'Seedream 视频', media: 'video', parser: null, protocol: null },
  { id: 'seedream-audio', label: 'Seedream 音频', media: 'audio', parser: null, protocol: null },
  { id: 'seedream-text', label: 'Seedream 文生文', media: 'text', parser: null, protocol: null },
] as const satisfies readonly ChannelOption[];

export type ChannelId = (typeof CHANNELS)[number]['id'];

/** 唯一「认不认这个取值」的判定点——别处不要再写一份成员判断。 */
export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && CHANNELS.some((channel) => channel.id === value);
}

/** 渠道 → 完整定义（含下拉标签）。查不到在类型上不可达，`?? CHANNELS[0]` 只是消掉 `.find` 的 `undefined`。 */
export function channelOf(id: ChannelId): ChannelOption {
  return CHANNELS.find((channel) => channel.id === id) ?? CHANNELS[0];
}

/** 该媒介的缺省渠道：`channel` 列为 NULL（回填不到的存量行 / 新建行）时的回落。
 *  按媒介分而不是恒落 `seedream-image`——video 行落成图片渠道，后端媒体闸门会在下次保存时
 *  判它非法，而运营什么都没改。 */
export function defaultChannelFor(capabilityType: unknown): ChannelId {
  switch (capabilityType) {
    case 'video':
      return 'seedream-video';
    case 'audio':
      return 'seedream-audio';
    case 'text':
      return 'seedream-text';
    default:
      return 'seedream-image';
  }
}

/** 库里 `channel` 原始值 → 渠道。读侧宽容：NULL / 认不出的取值都按媒介回落。
 *  归一（trim + 小写）只用于比对，不写回。 */
export function parseStoredChannel(raw: unknown, capabilityType: unknown): ChannelId {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (isChannelId(normalized)) return normalized;
  }
  return defaultChannelFor(capabilityType);
}

/** 下拉选项：只列**该媒介自己的**渠道。跨媒介的渠道对运营没有意义，也过不了后端媒体闸门。 */
export function channelsForMedia(media: unknown): ChannelOption[] {
  return CHANNELS.filter((channel) => channel.media === media);
}

export const GPT_PROVIDER_SIZES = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
  '2048x1360',
  '1360x2048',
  '1152x2048',
  '2048x1536',
  '1536x2048',
  '2048x880',
  '880x2048',
  '688x2048',
  '2048x688',
  '2048x1024',
  '1024x2048',
  'auto',
] as const;

export const DEFAULT_IMAGE_SIZES: ModelSize[] = [
  { id: '1K', label: '1K' },
  { id: '2K', label: '2K' },
  { id: '4K', label: '4K' },
];

export const DEFAULT_IMAGE_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'];

export type GptMatrix = Record<string, Record<string, string>>;

export type FormSnapshot = {
  type: ModelType;
  modelId: string;
  label: string;
  icon: string;
  sizes: SizeForm[];
  ratios: string[];
  durationMin: string;
  durationMax: string;
  durationStep: string;
  /** IKG4UR：该行 `supported_durations` 原本的形态。保存时按原形态写回——
   *  两种形态在读侧语义不同（数组被 durationInRange 当档位列表、对象当区间），
   *  擅自改形态会悄悄改掉该行的时长约束。新建行用 'object'（区间语义无歧义）。 */
  durationShape: 'array' | 'object';
  formats: string[];
  defaultSize: string;
  defaultRatio: string;
  defaultFormat: string;
  defaultDuration: string;
  enabled: boolean;
  features: Record<string, unknown>;
  /** 渠道（库里 `channel` 列，封闭枚举）。**解析与出站的唯一来源**——映射表怎么读、
   *  出站走哪种协议都由它决定，`parser` 只是它的一格展开（`channelOf(channel).parser`）。 */
  channel: ChannelId;
  /** 打开表单时该行的渠道（新建行 = 该媒介的缺省渠道）。用来判断「本次是否在换渠道」——
   *  切到 seedream 时旧族的矩阵必须显式清掉，而 seedream→seedream 则没有任何可表达的意图。 */
  originalChannel: ChannelId;
  /** 该行原本是否**有** request_mapping。seedream 行把矩阵清空等于让 worker 回落直传
   *  provider size（上游 400），故「原本有矩阵 → 现在全空」要拦下来而不是静默保留/清空。 */
  originalHadRequestMapping: boolean;
  gptMatrix: GptMatrix;
  /** IKHBDO：seedream 行的尺寸换算矩阵（`request_mapping.matrix`，形状与 gpt 行的 matrix
   *  一致，格子填像素尺寸如 `2048x2048`）。原先没有编辑器，运营改不了任何 seedream 尺寸档。 */
  seedreamMatrix: GptMatrix;
  bananaQuality: Record<string, string>;
  bananaSize: Record<string, string>;
  /**
   * 计价规则（`generation_model_capability.pricing` 列），形态与定价目录里那条逐字相同。
   *
   * <p>`undefined` = 本次**不提交**该字段 —— 库里那份原样保留（定价 tab 没被碰过时走这条）；
   * 对象 = 写入（表单 → `ruleFromForm`）。**不表达「清空」**：清空价 = 把
   * `basePrice.kind` 设成 `unset`（那是「单价待配」的合法形态，提交会被拒而不是按 0 免费）。
   */
  pricing?: unknown;
};

export function isImageChannelParserId(value: string): value is ImageChannelParserId {
  return (IMAGE_CHANNEL_PARSERS as readonly string[]).includes(value);
}

export function isGptProviderSize(value: string): boolean {
  return (GPT_PROVIDER_SIZES as readonly string[]).includes(value);
}

export function emptyGptMatrix(sizes: SizeForm[], ratios: string[]): GptMatrix {
  const matrix: GptMatrix = {};
  for (const size of sizes) {
    if (!size.id.trim()) continue;
    matrix[size.id] = Object.fromEntries(ratios.map((ratio) => [ratio, '']));
  }
  return matrix;
}

/** 尺寸/比例集合变化时**合并**已有矩阵，而不是重建。
 *  只保留仍存在的行与列，其余格子原样保位——重建会把整张表清零（IKHBDO：
 *  删一个尺寸行 / 删一个比例 chip 曾让整个交叉格归零）。 */
export function mergeMatrix(prev: GptMatrix, sizes: SizeForm[], ratios: string[]): GptMatrix {
  const rebuilt = emptyGptMatrix(sizes, ratios);
  for (const [sizeId, row] of Object.entries(prev)) {
    const target = rebuilt[sizeId];
    if (!target) continue;
    for (const ratio of ratios) {
      const cell = row[ratio];
      if (cell !== undefined) target[ratio] = cell;
    }
  }
  return rebuilt;
}

/** 库里 `supported_sizes` 原始 JSON → 表单行。读侧兼容 camelCase `apiValue`
 *  （与 backend `toSizes` 的 `o.apiValue ?? o.api_value` 同口径）。 */
export function sizesFromModel(raw: unknown): SizeForm[] {
  if (!Array.isArray(raw)) return [];
  const out: SizeForm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const apiValue = o.apiValue ?? o.api_value;
    out.push({
      id: typeof o.id === 'string' ? o.id : '',
      label: typeof o.label === 'string' ? o.label : '',
      apiValue: typeof apiValue === 'string' ? apiValue : '',
      width: typeof o.width === 'number' && Number.isFinite(o.width) ? String(o.width) : '',
      height: typeof o.height === 'number' && Number.isFinite(o.height) ? String(o.height) : '',
    });
  }
  return out;
}

function positiveInt(value?: string): number | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 表单尺寸行 → 提交形态。留空的扩展字段直接**不写该键**（读侧回落 id / null），
 *  这样「清空输入框」才是真的有出口。 */
export function sizeToWire(size: SizeForm): ModelSizeWire {
  const out: ModelSizeWire = { id: size.id.trim() };
  const label = (size.label ?? '').trim();
  if (label) out.label = label;
  const apiValue = (size.apiValue ?? '').trim();
  if (apiValue) out.api_value = apiValue;
  const width = positiveInt(size.width);
  if (width !== null) out.width = width;
  const height = positiveInt(size.height);
  if (height !== null) out.height = height;
  return out;
}

/** 库里矩阵键 → 表单键的规范化匹配：命中返回**表单自己的拼写**，未命中返回 undefined。
 *  IKHTL0：同一行的 `supported_sizes[].id` 与 `request_mapping.matrix` 键由两次迁移分别写入，
 *  大小写可能不一致（id 写小写 `1k`，IK629 的矩阵键写大写 `1K`）。worker 查表本来就走
 *  大小写不敏感口径（`ImageChannelMapper.resolveSeedreamSize` 有显式兜底），读侧用精确匹配
 *  会让这些行的矩阵整张显空白。读侧必须与 worker 同口径。 */
function matchFormKey(formKeys: string[], raw: string): string | undefined {
  if (formKeys.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  return formKeys.find((key) => key.toLowerCase() === lower);
}

export function parseGptMatrix(mapping: unknown, sizes: SizeForm[], ratios: string[]): GptMatrix {
  const base = emptyGptMatrix(sizes, ratios);
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return base;
  const matrix = (mapping as { matrix?: unknown }).matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return base;
  const sizeIds = sizes.map((size) => size.id).filter((id) => id.trim());
  for (const [rawSizeId, row] of Object.entries(matrix as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    // 命中表单尺寸 → 归一到表单 id；命不中则**原样保留**——表单外的键在保存时不得被静默抹掉。
    const sizeId = matchFormKey(sizeIds, rawSizeId) ?? rawSizeId;
    const cells: Record<string, string> = {};
    for (const [rawRatio, cell] of Object.entries(row as Record<string, string>)) {
      cells[matchFormKey(ratios, rawRatio) ?? rawRatio] = cell;
    }
    base[sizeId] = { ...(base[sizeId] ?? {}), ...cells };
  }
  return base;
}

export function parseBananaMaps(
  mapping: unknown,
): { quality: Record<string, string>; size: Record<string, string> } {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { quality: {}, size: {} };
  }
  const record = mapping as { quality?: unknown; size?: unknown };
  return {
    quality:
      record.quality && typeof record.quality === 'object' && !Array.isArray(record.quality)
        ? { ...(record.quality as Record<string, string>) }
        : {},
    size:
      record.size && typeof record.size === 'object' && !Array.isArray(record.size)
        ? { ...(record.size as Record<string, string>) }
        : {},
  };
}

export function compactGptMatrix(matrix: GptMatrix): GptMatrix {
  const out: GptMatrix = {};
  for (const [sizeId, row] of Object.entries(matrix)) {
    const cells: Record<string, string> = {};
    for (const [ratio, cell] of Object.entries(row)) {
      if (cell.trim()) cells[ratio] = cell.trim();
    }
    if (Object.keys(cells).length) out[sizeId] = cells;
  }
  return out;
}

export function compactStringMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.trim() && value.trim()) out[key.trim()] = value.trim();
  }
  return out;
}

export function validateGptMatrix(matrix: GptMatrix): string | null {
  for (const row of Object.values(matrix)) {
    for (const cell of Object.values(row)) {
      if (!cell.trim()) continue;
      if (!isGptProviderSize(cell.trim())) {
        return `gpt 交叉格只能填官方 size 枚举或留空：${cell}`;
      }
    }
  }
  return null;
}

/** seedream 矩阵格子：像素尺寸（`2048x2048`）；`auto` 放行（与 gpt 枚举同名的透传值）。
 *  写成 `1k` 这类非像素值会被上游 400，且界面上看不出问题，所以保存前拦下。 */
export function validateSeedreamMatrix(matrix: GptMatrix): string | null {
  for (const row of Object.values(matrix)) {
    for (const cell of Object.values(row)) {
      const value = cell.trim();
      if (!value) continue;
      if (value.toLowerCase() === 'auto') continue;
      if (!/^\d+\s*[x×]\s*\d+$/.test(value)) {
        return `seedream 矩阵格只能填像素尺寸（如 2048x2048）或留空：${value}`;
      }
    }
  }
  return null;
}

/** IKHTL0：seedream 行的矩阵键必须是该档位的 **api_value**，不是 `supported_sizes[].id`。
 *  worker 的查找链是「按 id 命中 supported_sizes 条目 → 取该条目的 api_value 当 providerSize
 *  → 再用它当矩阵查找键」（`ImageChannelMapper.matchSupportedSize` / `resolveSeedreamSize`）。
 *  表单内部按 `size.id` 存键（渲染要按 id 取格），提交时在这里换回 api_value 拼写——
 *  否则一次「什么都没改」的保存就会把库里 `1K` 的键改写成 `1k`，靠 worker 的大小写兜底
 *  才不出事，等于把一个隐性不变式悄悄写坏。没有 api_value 的档位回落到 id。 */
function seedreamWireMatrix(matrix: GptMatrix, sizes: SizeForm[]): GptMatrix {
  const wireKey = new Map(sizes.map((size) => [size.id, (size.apiValue ?? '').trim() || size.id]));
  const out: GptMatrix = {};
  for (const [sizeId, row] of Object.entries(matrix)) {
    out[wireKey.get(sizeId) ?? sizeId] = row;
  }
  return out;
}

/** 提交用的 request_mapping 意图（IKHBDO，与 backend `parseParserAndMapping` 契约对齐）：
 *  - `undefined`：本次**不提交**该字段——库里原样保留（seedream→seedream 的唯一正确表达：
 *    界面上没有「清空矩阵」入口，diff 提交里那个 null 不是运营意图）；
 *  - `null`：显式清空——只用于「从别的解析器切到 seedream」，此时旧族的矩阵必须消失，
 *    否则 worker 会拿 gpt 的矩阵去算 seedream 尺寸，而界面上再也清不掉；
 *  - 对象：写入新映射表。 */
/** @param parser 渠道展开出的解析器（= `channelOf(form.channel).parser ?? 'seedream'`）。
 *  由调用方传进来而不是在这里再展开一次——`form.channel` 是唯一来源，两处各展开一次
 *  就是两处判定。 */
export function buildRequestMapping(
  form: FormSnapshot,
  parser: ImageChannelParserId = channelOf(form.channel).parser ?? 'seedream',
): unknown | undefined {
  if (form.type !== 'image') return undefined;
  if (parser === 'seedream') {
    const matrix = compactGptMatrix(seedreamWireMatrix(form.seedreamMatrix, form.sizes));
    if (Object.keys(matrix).length) return { matrix };
    return channelOf(form.originalChannel).parser === 'seedream' ? undefined : null;
  }
  if (parser === 'gpt') return { matrix: compactGptMatrix(form.gptMatrix) };
  return {
    quality: compactStringMap(form.bananaQuality),
    size: compactStringMap(form.bananaSize),
  };
}

function parseDurationFields(form: FormSnapshot): number[] | DurationRange | null {
  const min = form.durationMin.trim();
  const max = form.durationMax.trim();
  const step = form.durationStep.trim();
  if (!min && !max && !step) return null;
  // IKHBDO：按**位置**取三项，不能 `[min,max,step].filter(Boolean)`——「只填 min + step、
  // 留空 max」会让 step 顶到第 2 位被写成 max，区间被静默改错（4~30 变成「4 起、每 1 秒一档」的谎）。
  // 任一项缺失/非数字/为负 → null，由调用方给出可读报错，绝不半写。
  if (!min || !max) return null;
  const minN = Number(min);
  const maxN = Number(max);
  if (!Number.isInteger(minN) || !Number.isInteger(maxN) || minN < 0 || maxN < 0) return null;
  if (minN > maxN) return null;
  const stepN = step ? Number(step) : undefined;
  if (stepN !== undefined && (!Number.isFinite(stepN) || stepN <= 0)) return null;
  // IKG4UR：按**原形态**写回——数组行写数组、对象行写对象。
  // 两种形态在读侧语义不同（数组被 durationInRange 当档位列表用、对象当区间用），
  // 保存时若擅自改形态，会把该行的时长约束悄悄改掉（如 4–30 缩成 {1,4,30}）。
  if (form.durationShape === 'array') {
    return stepN === undefined ? [minN, maxN] : [minN, maxN, stepN];
  }
  return stepN === undefined ? { min: minN, max: maxN } : { min: minN, max: maxN, step: stepN };
}

export function typeName(type: ModelType) {
  return TYPE_TABS.find((item) => item.key === type)?.label ?? type;
}

export function buildCreateParams(form: FormSnapshot): { ok: true; value: CreateAdminModelParams } | { ok: false; error: string } {
  const parser = channelOf(form.channel).parser ?? 'seedream';
  const originalParser = channelOf(form.originalChannel).parser ?? 'seedream';
  if (!form.modelId.trim() || !form.label.trim()) {
    return { ok: false, error: '模型 ID、展示名为必填项。' };
  }
  if (form.type === 'image' && parser === 'gpt') {
    const gptErr = validateGptMatrix(form.gptMatrix);
    if (gptErr) return { ok: false, error: gptErr };
  }
  if (form.type === 'image' && parser === 'seedream') {
    const seedreamErr = validateSeedreamMatrix(form.seedreamMatrix);
    if (seedreamErr) return { ok: false, error: seedreamErr };
    // 把矩阵整张清空 = 让 worker 回落成「直传 provider size」（IK629 之前的老毛病，
    // 上游 400 Invalid size）。库里本来有矩阵时这绝不是运营意图，拦下并说明。
    if (originalParser === 'seedream' && form.originalHadRequestMapping && !Object.keys(compactGptMatrix(form.seedreamMatrix)).length) {
      return {
        ok: false,
        error: 'Seedream 尺寸矩阵不能整张清空（清空后该模型出站尺寸会回落成 provider 原值，上游会 400）。至少保留一格。',
      };
    }
  }

  // IKG4UR：时长只对视频可配（音频上游无 duration 参数、库里已置 NULL）——
  // 在代码层钉死不变式「supported_durations 非空 ⟺ 该模型时长可配」。
  const durations = form.type === 'video' ? parseDurationFields(form) : null;
  // IKG4UR：**任一时长字段有值就必须成对**——原先的条件是 `min && max`，
  // 只在两端都填时才可能进入，而「只填一端」恰恰是它文案说的场景（条件恒假 = 校验形同虚设）：
  // 视频行清空「最大秒」会被静默存成「不配时长」（滑杆消失、服务端放行任意正数）。
  if (form.type === 'video' && (form.durationMin || form.durationMax || form.durationStep)) {
    if (durations == null) {
      return {
        ok: false,
        error: '时长须填非负整数，且最小 / 最大需成对填写、最小不得大于最大；步长（选填）须为正数。',
      };
    }
  }

  const sizes = form.type === 'text' || form.type === 'audio' ? [] : form.sizes.filter((s) => s.id.trim()).map(sizeToWire);
  const ratios = form.type === 'text' || form.type === 'audio' ? [] : form.ratios.filter(Boolean);
  const formats = form.type === 'text' ? [] : form.formats.filter(Boolean);

  let defaultDuration: number | null = null;
  if ((form.type === 'video' || form.type === 'audio') && form.defaultDuration.trim()) {
    defaultDuration = parseInt(form.defaultDuration, 10);
    if (Number.isNaN(defaultDuration) || defaultDuration < 0) {
      return { ok: false, error: '默认时长须为非负整数（秒）。' };
    }
  }

  const params: CreateAdminModelParams = {
    provider_id: DEFAULT_PROVIDER_ID,
    model_id: form.modelId.trim(),
    capability_type: form.type,
    model_label: form.label.trim(),
    icon: form.icon.trim() || null,
    supported_sizes: sizes,
    supported_aspect_ratios: ratios,
    supported_durations: durations,
    supported_formats: formats,
    // IKHEXG：这两列在后端是 NOT NULL（VarChar），「未配」的形态是**空串**——
    // 发 null 会被写闸门拒（保存必然 400，实测症状）。非图片/视频行没有尺寸/比例概念，同样发空串。
    default_size: form.type === 'image' || form.type === 'video' ? form.defaultSize.trim() : '',
    default_aspect_ratio: form.type === 'image' || form.type === 'video' ? form.defaultRatio.trim() : '',
    default_format: form.type === 'text' ? null : form.defaultFormat.trim() || null,
    default_duration: defaultDuration,
    features: form.features,
    enabled: form.enabled,
  };
  if (form.type === 'image') {
    // 渠道是解析与出站的唯一来源；库里只有这一处记着「这个模型走哪家」。
    params.channel = form.channel;
    // IKHBDO：`undefined` = 本次不提交该字段（库里原样保留），不能写成 null——
    // seedream 行的 null 在更新侧被后端当「不改」，而在新建/切族场景两者含义不同。
    const mapping = buildRequestMapping(form, parser);
    if (mapping !== undefined) params.request_mapping = mapping;
  }
  // 同 request_mapping 的口径：undefined = 不提交该字段。定价 tab 没被碰过时**原样保留库里那份**，
  // 「打开看一眼、点保存」不会用一份从空表单拼出来的规则把它覆盖掉。
  if (form.pricing !== undefined) params.pricing = form.pricing;
  return { ok: true, value: params };
}

export function diffUpdateParams(
  initial: AdminModel,
  created: CreateAdminModelParams,
): Partial<CreateAdminModelParams> {
  const changes: Partial<CreateAdminModelParams> = {};
  if (created.model_label !== initial.model_label) changes.model_label = created.model_label;
  if ((created.icon ?? null) !== (initial.icon ?? null)) changes.icon = created.icon ?? null;
  if (JSON.stringify(created.supported_sizes ?? []) !== JSON.stringify(initial.supported_sizes ?? [])) {
    changes.supported_sizes = created.supported_sizes;
  }
  if (
    JSON.stringify(created.supported_aspect_ratios ?? []) !==
    JSON.stringify(initial.supported_aspect_ratios ?? [])
  ) {
    changes.supported_aspect_ratios = created.supported_aspect_ratios;
  }
  if (JSON.stringify(created.supported_durations ?? null) !== JSON.stringify(initial.supported_durations ?? null)) {
    changes.supported_durations = created.supported_durations ?? null;
  }
  if (JSON.stringify(created.supported_formats ?? []) !== JSON.stringify(initial.supported_formats ?? [])) {
    changes.supported_formats = created.supported_formats;
  }
  if (JSON.stringify(created.features ?? {}) !== JSON.stringify(initial.features ?? {})) {
    changes.features = created.features;
  }
  // IKHEXG：两侧都归一到空串再比。库里是 ''、create 侧对非图片/视频行恒为 ''，用 `?? null` 比会把
  // 「其实等价」判成变更，进而把 null 塞进提交体被写闸门拒——非图片/视频行保存必然 400 的根因。
  if ((created.default_size ?? '') !== (initial.default_size ?? '')) changes.default_size = created.default_size ?? '';
  if ((created.default_aspect_ratio ?? '') !== (initial.default_aspect_ratio ?? '')) {
    changes.default_aspect_ratio = created.default_aspect_ratio ?? '';
  }
  if ((created.default_format ?? null) !== (initial.default_format ?? null)) {
    changes.default_format = created.default_format ?? null;
  }
  if ((created.default_duration ?? null) !== (initial.default_duration ?? null)) {
    changes.default_duration = created.default_duration ?? null;
  }
  if (created.enabled !== initial.enabled) changes.enabled = created.enabled;
  // 渠道是解析与出站的唯一来源。比较走**归一后**的取值：库里存量行可能是 NULL（回填不到的
  // 行），直接比 `!==` 会把「原样保存」判成变更，在审计里冒出一条运营没做过的改动。
  if (
    parseStoredChannel(created.channel, initial.capability_type) !==
    parseStoredChannel(initial.channel, initial.capability_type)
  ) {
    changes.channel = created.channel;
  }
  // IKHBDO：`undefined` = 表单没有可表达的映射意图（seedream 行），既不算变更也不要覆盖——
  // 原先无条件比较 `?? null`，让每个 seedream 行的「原样保存」都提交一次 null。
  if (
    created.request_mapping !== undefined &&
    JSON.stringify(created.request_mapping) !== JSON.stringify(initial.request_mapping ?? null)
  ) {
    changes.request_mapping = created.request_mapping;
  }
  // 同 request_mapping：`undefined` = 表单没有可表达的定价意图（定价 tab 没被碰过），
  // 既不算变更也不要覆盖。比的是**序列化后的对象**——`ruleFromForm` 对没动过的价是恒等的
  // （见 `MoneyField` 的 originalMc 约定），所以「打开看一眼、点保存」在这里判成无变更。
  if (
    created.pricing !== undefined &&
    JSON.stringify(created.pricing) !== JSON.stringify(initial.pricing ?? null)
  ) {
    changes.pricing = created.pricing;
  }
  return changes;
}

export function durationsFromModel(model?: AdminModel): { min: string; max: string; step: string } {
  const raw = model?.supported_durations;
  // IKG4UR：库里 `supported_durations` 有数组与对象两种形态——管理端提交用数组，
  // 而消费端契约、种子与迁移写入的是 `{min,max,step}`。只认数组会让表单把对象行读成空串，
  // 保存时整列被覆盖成 null（静默数据损坏）。两种形态都要认，往返才无损。
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const range = raw as { min?: unknown; max?: unknown; step?: unknown };
    return {
      min: range.min != null ? String(range.min) : '',
      max: range.max != null ? String(range.max) : '',
      step: range.step != null ? String(range.step) : '',
    };
  }
  if (!Array.isArray(raw) || raw.length === 0) return { min: '', max: '', step: '' };
  return {
    min: raw[0] != null ? String(raw[0]) : '',
    max: raw[1] != null ? String(raw[1]) : '',
    step: raw[2] != null ? String(raw[2]) : '',
  };
}

/** 该行的解析器（用于「打开时是不是 seedream」这类判断）。渠道是唯一来源：
 *  非图片渠道的 parser 为 null，回落 `'seedream'` 与旧列 NOT NULL DEFAULT 对齐。 */
export function parserFromModel(model?: AdminModel): ImageChannelParserId {
  return channelOf(channelFromModel(model)).parser ?? 'seedream';
}

/** 库里的行 → 渠道。**直接读 `channel` 列**（不再由 `channel_parser` × `image_protocol`
 *  两个字段合成）：渠道列为 NULL 的存量行按行的媒介回落，口径与后端 `parseStoredChannel` 一致。 */
export function channelFromModel(model?: AdminModel): ChannelId {
  return parseStoredChannel(model?.channel, model?.capability_type);
}

/** features 取值：优先 snake_case，缺失回落 camelCase。
 *  读侧（backend `toFeatures` / worker-java）**优先 camelCase**，只认 snake_case 会让
 *  camel 行的结构化控件显空白，而实际生效的仍是 camel 值。 */
export function readFeature(features: Record<string, unknown> | undefined, key: string): unknown {
  if (!features) return undefined;
  const snake = features[key];
  return snake !== undefined ? snake : features[camelFeatureKey(key)];
}

/** 该 features 对象里是否出现过这个键（含 camelCase 写法）。
 *  用来判断「结构化控件关掉一个布尔位」要不要显式写 false。 */
export function hasFeatureKey(features: Record<string, unknown> | undefined, key: string): boolean {
  if (!features) return false;
  return key in features || camelFeatureKey(key) in features;
}

/** 结构化控件能承载的取值类型。类型不符的脏值不归控件管，留在高级 JSON 里原样回写，
 *  避免「读成空白 → 保存把整个键删掉」这种静默数据丢失（写侧闸门会拒，报错好过丢数据）。 */
const FEATURE_NUMBER_KEYS = new Set([
  'image_reference_max',
  'quantity_max',
  'max_prompt_length',
  'video_reference_max',
  'audio_reference_max',
  'max_reference_duration_sec',
]);
/** 字符串型键的**类型闸门**：这里决定「这个键归结构化控件管（取值合法就进 features、不进高级
 *  JSON）还是当脏值留在高级 JSON 里」。
 *  ⚠️ 这里**曾经有一个 `image_protocol`**（出站协议）。它已随渠道列落地**整键退役**：
 *  协议现在由渠道决定（`channelOf(channel).protocol`），键本身也被迁移清掉了。 */
const FEATURE_STRING_KEYS = new Set(['i2i_model_name']);

export function featureValueTypeOk(key: string, value: unknown): boolean {
  if (FEATURE_NUMBER_KEYS.has(key)) return typeof value === 'number' && Number.isFinite(value);
  if (FEATURE_STRING_KEYS.has(key)) return typeof value === 'string';
  return typeof value === 'boolean';
}

/** `features.task_types` → 每个任务类型的 allowed_ratios（表单态）。
 *  其它子键（如已退役的 allowed_durations）与未列出的任务类型不进表单，由 `buildTaskTypes` 原样带回。 */
export function pickTaskTypeRatios(features: Record<string, unknown> | undefined): Record<string, string[]> {
  const raw = readFeature(features, 'task_types');
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string[]> = {};
  for (const taskType of TASK_TYPE_KEYS) {
    const entry = map[taskType];
    const ratios =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).allowed_ratios
        : undefined;
    out[taskType] = Array.isArray(ratios) ? ratios.filter((x): x is string => typeof x === 'string') : [];
  }
  return out;
}

/** 表单的 task_types 编辑态 + 原对象 → 提交用的 task_types。
 *  只动 `allowed_ratios`：其它子键、其它任务类型原样保留（整包替换会把它们抹掉）。 */
export function buildTaskTypes(
  base: Record<string, unknown>,
  ratios: Record<string, string[]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const taskType of TASK_TYPE_KEYS) {
    const list = (ratios[taskType] ?? []).map((s) => s.trim()).filter(Boolean);
    const entry = base[taskType];
    const rest =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? { ...(entry as Record<string, unknown>) }
        : {};
    delete rest.allowed_ratios;
    if (list.length) out[taskType] = { ...rest, allowed_ratios: list };
    else if (Object.keys(rest).length) out[taskType] = rest;
    else delete out[taskType];
  }
  return out;
}
