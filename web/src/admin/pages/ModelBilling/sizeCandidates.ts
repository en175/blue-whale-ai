/* ============================================
 * 定价页的**档位候选集**：从模型配置（`generation_model_capability`）派生
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────
 *
 * 用户口径：「模型尺寸表，模型配置里面有啊，不是在模型价格这而已」。
 *
 * 在此之前，定价页的「价格表」与「尺寸表」两处规格键都是**自由文本框**：运营按记忆
 * 手敲 `resolution=720p|aspect_ratio=16:9`。而同一个事实——「这个模型有哪些档位、
 * 哪些宽高比」——已经在**模型配置**里声明过了。于是同一件事有两个真相源，并且已经漂了：
 *
 *   · `doubao-seedream-5-0-pro-260628`：能力行是 1k / 1.5k / 2k，目录里配的是
 *     1k / 2k / 4k —— `size=4k` 是用户根本选不到的死配置，`size=1.5k` 反而**没价**
 *     （选到 1.5K 的提交会被 billing 按 UNPRICEABLE 拒绝）。
 *   · 视频 2.5 的尺寸表里有 `resolution=4k|…`，而它的能力行只声明到 1080p。
 *
 * 所以候选集改为**派生**：档位与比例取自能力行，运营在定价页只填**数**（宽高 / 单价），
 * 不再手敲键。派生是纯函数，所以能单测。
 *
 * ── 数据主权：为什么是「页面读能力行」而不是「billing 读能力行」 ────────────────
 *
 * 能力行在 `blue_whale` 库；定价目录在 billing 自己的库（两者不共享库，见 ADR-0114
 * 「billing-svc 与 worker-java 不共享进程、不共享库」）。让 billing 去查 `blue_whale`
 * 会打破那条边界，还要给「目录编译」这条纯函数路径接一个外部依赖。
 *
 * 这里走的是**另一条**：管理端页面本来就已经在调 `/api/admin/models`（backend 是
 * `blue_whale` 的属主，路由过 AdminGuard），页面拿它来**预填**候选键；发布出去的仍然是
 * 一份完整的目录 JSON —— billing 只看见目录，看不见能力行。边界不动。
 *
 * ── 退化口径（读不到能力行时）─────────────────────────────────────────────────
 *
 * 读不到 / 该模型没有能力行时，`capability` 是 `null`，调用方退回原来的自由键值编辑，
 * 并在界面上说明「候选集读不到」。**不猜**一份档位清单顶上去——那等于把漂移换个地方发生。
 * ============================================ */
import type { AdminModel } from '@/api/admin';

/** 能力行里的一个档位。除 id 外都是可选：历史行可能没有 api_value / 宽高。 */
export interface CapabilitySize {
  id: string;
  label: string;
  /** 出站实际提交给上游的档位值；消费端在它缺失时回落用 id。 */
  apiValue: string;
  /** 像素宽高（图片侧的能力行矩阵里有；视频侧能力行一般不写，见文件头）。 */
  width: number | null;
  height: number | null;
}

/** 一个模型的能力视图：定价页派生候选集需要的全部字段。 */
export interface ModelCapabilityView {
  modelId: string;
  capabilityType: string;
  sizes: CapabilitySize[];
  ratios: string[];
  /** 默认宽高比；能力行没写时为空串（**不猜**）。用于给每种档位挑一格显示像素。 */
  defaultRatio: string;
  /**
   * `request_mapping.matrix`：档位键 → 比例 → 「宽x高」。
   * 图片模型的矩阵在这里；视频模型是 `null`（宽高只能在定价目录里填，见 ADR 与
   * `TokenEstimator` 的「公式在代码里、参数在目录里」）。
   */
  matrix: Record<string, Record<string, string>>;
}

/** 一条定价轴：轴名 + 该轴的合法取值。 */
export interface SpecAxis {
  name: string;
  values: string[];
}

/**
 * 视频输入档轴（`video=0/1`）。
 *
 * ⚠️ 它**不来自能力行**：它不是一个可选的模型能力，而是火山计费的**档位划分**
 * （「输入不含视频 / 输入包含视频」写作 `video0` / `video1`）。轴名与取值是跨进程的
 * 规格契约，与 `backend/libs/shared/billing/billing-specs.ts` 的 `VIDEO_TIER_VALUES`
 * 是三处逐字一致的那一对（预扣 TS / 结算 Java / 本页）。
 */
export const VIDEO_TIER_AXIS: SpecAxis = { name: 'video', values: ['0', '1'] };

/** 由能力行给出的轴名：这三种写法都落到「这个模型的档位 / 宽高比」。 */
const SIZE_AXIS_NAMES = ['size', 'resolution'];
const RATIO_AXIS_NAMES = ['aspect_ratio'];

/** 尺寸表（token 尺寸表）恒定的两根轴：分辨率档 × 宽高比。 */
export const DIMENSION_AXIS_NAMES = ['resolution', 'aspect_ratio'];

/** 展示时的规范轴序：档位 → 比例 → 视频档 → 时长。与目录里既有键的写法一致。 */
const AXIS_ORDER = ['resolution', 'size', 'aspect_ratio', 'video', 'duration'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `request_mapping` 原始 JSON → 矩阵视图。形状不对就当没有（本页只读不造）。 */
function readMatrix(raw: unknown): Record<string, Record<string, string>> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const matrix = (raw as { matrix?: unknown }).matrix;
  if (matrix === null || typeof matrix !== 'object' || Array.isArray(matrix)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [sizeKey, row] of Object.entries(matrix as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const cells: Record<string, string> = {};
    for (const [ratio, cell] of Object.entries(row as Record<string, unknown>)) {
      if (typeof cell === 'string' && cell.trim()) cells[ratio] = cell.trim();
    }
    if (Object.keys(cells).length) out[sizeKey] = cells;
  }
  return out;
}

function toCapabilitySize(raw: unknown): CapabilitySize | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const size: CapabilitySize = {
    id: readString(o.id),
    label: readString(o.label),
    // 读侧兼容 camelCase `apiValue`（与 backend `toSizes` 同口径）
    apiValue: readString(o.apiValue ?? o.api_value),
    width: readNumber(o.width),
    height: readNumber(o.height),
  };
  return size.id ? size : null;
}

/**
 * 模型列表 → 按 `model_id` 索引的能力视图。
 *
 * 同一 `model_id` 出现多行时**优先启用行**：停用行还留在库里（软删前的历史），
 * 拿它当候选集会把已经下线的档位配成"必需"，而线上用户根本选不到。
 */
export function buildCapabilityIndex(models: AdminModel[]): Map<string, ModelCapabilityView> {
  const index = new Map<string, ModelCapabilityView>();
  const enabled = new Map<string, boolean>();
  for (const model of models) {
    const modelId = readString(model.model_id);
    if (!modelId) continue;
    const previous = enabled.get(modelId);
    const isEnabled = model.enabled !== false;
    if (previous !== undefined && (previous || !isEnabled)) continue;
    index.set(modelId, toView(modelId, model));
    enabled.set(modelId, isEnabled);
  }
  return index;
}

function toView(modelId: string, model: AdminModel): ModelCapabilityView {
  const rawSizes = Array.isArray(model.supported_sizes) ? model.supported_sizes : [];
  const sizes = rawSizes.map(toCapabilitySize).filter((s): s is CapabilitySize => s !== null);
  const ratios = (Array.isArray(model.supported_aspect_ratios) ? model.supported_aspect_ratios : [])
    .map(readString)
    .filter((r) => r.length > 0);
  return {
    modelId,
    capabilityType: readString(model.capability_type),
    sizes,
    ratios,
    defaultRatio: readString(model.default_aspect_ratio),
    matrix: readMatrix(model.request_mapping),
  };
}

/**
 * 轴名 → 取值。**能力行给不出取值时返回 `null`**（调用方据此退回自由编辑），
 * 而不是返回空数组——空数组会渲染成「这个模型一档都没有」，那是另一个意思。
 */
export function axisValues(view: ModelCapabilityView, axisName: string): string[] | null {
  const name = axisName.trim().toLowerCase();
  if (SIZE_AXIS_NAMES.includes(name)) {
    const ids = view.sizes.map((s) => s.id).filter((id) => id.length > 0);
    return ids.length ? ids : null;
  }
  if (RATIO_AXIS_NAMES.includes(name)) {
    return view.ratios.length ? [...view.ratios] : null;
  }
  if (name === VIDEO_TIER_AXIS.name) return [...VIDEO_TIER_AXIS.values];
  return null;
}

function sortAxes(axes: SpecAxis[]): SpecAxis[] {
  return [...axes].sort((a, b) => {
    const ia = AXIS_ORDER.indexOf(a.name);
    const ib = AXIS_ORDER.indexOf(b.name);
    return (ia < 0 ? AXIS_ORDER.length : ia) - (ib < 0 ? AXIS_ORDER.length : ib);
  });
}

/**
 * 轴清单 → 候选规格键（笛卡尔积）。
 *
 * 键的拼写与目录里既有键逐字一致（`resolution=720p|aspect_ratio=16:9`）——
 * billing 加载时会 `PricingKeys.normalizeKey` 重拼一次（顺序无所谓、大小写不敏感），
 * 但**展示与存储用同一套写法**才能让运营照着官方文档核对。
 *
 * @returns 任一轴取不到取值时返回 `null`（＝派生不出来，调用方退回自由编辑）
 */
export function candidateSpecKeys(axes: SpecAxis[]): string[] | null {
  if (axes.length === 0) return null;
  let keys = [''];
  for (const axis of sortAxes(axes)) {
    if (axis.values.length === 0) return null;
    keys = keys.flatMap((prefix) =>
      axis.values.map((value) =>
        prefix ? `${prefix}|${axis.name}=${value}` : `${axis.name}=${value}`,
      ),
    );
  }
  return keys;
}

/** 从一组已有的规格键里抽出轴名（用于「目录里声明的轴」这一点没有 `by` 时可读）。 */
export function axesOfKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    for (const pair of key.split('|')) {
      const at = pair.indexOf('=');
      if (at > 0) seen.add(pair.slice(0, at).trim().toLowerCase());
    }
  }
  return [...seen];
}

/**
 * **价格表**的候选键（`basePrice.table`）。
 *
 * 轴来自规则自己声明的 `basePrice.by`（它就是这个表的定价轴）；读不出来时退回
 * 从表里既有的键抽轴——两种都是目录自己说的话，不是页面猜的。
 *
 * ⚠️ `video` 轴在 `by` 里而能力行给不出它，走 {@link VIDEO_TIER_AXIS} 的固定两档。
 *
 * @returns 派生不出来（轴不全在能力行里）时返回 `null`
 */
export function priceTableCandidates(
  view: ModelCapabilityView,
  by: string[],
  existingKeys: string[],
): string[] | null {
  const declared = by.length ? by : axesOfKeys(existingKeys);
  if (declared.length === 0) return null;
  const axes: SpecAxis[] = [];
  for (const name of declared) {
    const values = axisValues(view, name);
    if (values === null) return null;
    axes.push({ name: name.trim().toLowerCase(), values });
  }
  return candidateSpecKeys(axes);
}

/**
 * **尺寸表**（`tokenEstimate.dimensions`）的候选键：分辨率档 × 宽高比。
 *
 * 这是用户点名的那张表——它的「有哪些 (档位 × 比例) 组合需要填」正是能力行里
 * `supported_sizes` × `supported_aspect_ratios` 两个字段。
 *
 * @returns 派生不出来时返回 `null`
 */
export function dimensionTableCandidates(view: ModelCapabilityView): string[] | null {
  const axes: SpecAxis[] = [];
  for (const name of DIMENSION_AXIS_NAMES) {
    const values = axisValues(view, name);
    if (values === null) return null;
    axes.push({ name, values });
  }
  return candidateSpecKeys(axes);
}

/** 大小写不敏感取矩阵格子（与 worker `ImageChannelMapper.lookupMatrixCell` 同口径）。 */
function matrixCell(
  matrix: Record<string, Record<string, string>>,
  sizeKey: string,
  ratio: string,
): string | null {
  const row = matchKey(matrix, sizeKey);
  if (row === null) return null;
  return matchValue(row, ratio);
}

function matchKey(record: Record<string, unknown>, raw: string): Record<string, string> | null {
  const direct = record[raw];
  if (direct !== undefined && typeof direct === 'object' && direct !== null) {
    return direct as Record<string, string>;
  }
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower && value !== null && typeof value === 'object') {
      return value as Record<string, string>;
    }
  }
  return null;
}

function matchValue(record: Record<string, unknown>, raw: string): string | null {
  const direct = record[raw];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lower && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** 解析 `2048x2048` → 两个数；不是这个形态返回 `null`。 */
export function parsePixels(spec: string): { width: number; height: number } | null {
  const matched = /^(\d+)\s*[x×]\s*(\d+)$/.exec(spec.trim());
  if (matched === null) return null;
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * 新建规则时先摆哪几根轴。
 *
 * ⚠️ 它**只是新建时的初值**，不是事实源：规则一旦存进目录，轴以 `basePrice.by` 为准
 * （`CatalogDocument.BasePrice.by`）；而每一根轴的**取值**一律来自能力行。
 * 之所以按基准维度推：基准维度就决定了「这份单价是按什么单位收的」——
 * 按 token 收（`usage.c`）就要分分辨率档与视频输入档，按张收（`usage.succeededSlots`）
 * 就要分尺寸档。没有对应轴可推时返回空数组（调用方退回自由编辑）。
 */
export function defaultAxesForBaseUnit(baseUnit: string): string[] {
  switch (baseUnit.trim()) {
    case 'usage.c':
      return ['resolution', VIDEO_TIER_AXIS.name];
    case 'usage.succeededSlots':
      return ['size'];
    default:
      return [];
  }
}

/** 规格键里某一根轴的值；没有这根轴时返回空串。 */
export function axisValueInKey(specKey: string, axisName: string): string {
  const wanted = axisName.trim().toLowerCase();
  for (const pair of specKey.split('|')) {
    const at = pair.indexOf('=');
    if (at > 0 && pair.slice(0, at).trim().toLowerCase() === wanted) {
      return pair.slice(at + 1).trim();
    }
  }
  return '';
}

/** 价格表里某个规格键对应的档位在能力行里的声明（用于显示像素 / 提示孤儿档位）。 */
export function sizeOfSpecKey(
  view: ModelCapabilityView,
  specKey: string,
): CapabilitySize | null {
  const sizeId = axisValueInKey(specKey, 'size') || axisValueInKey(specKey, 'resolution');
  if (!sizeId) return null;
  const lower = sizeId.toLowerCase();
  return view.sizes.find((size) => size.id.toLowerCase() === lower) ?? null;
}

/**
 * 一个档位在**模型配置**里已经记着的宽高（图片走矩阵；视频能力行一般不写）。
 *
 * 定价页拿它做两件事：给价格表那行标出像素数（图片按像素分档时，运营得看得见
 * 2K = 419 万这种数），以及给尺寸表预填。
 *
 * 优先取默认比例的格子（能力行的 `default_aspect_ratio`），没有再取矩阵里第一格。
 */
export function configuredSizePixels(
  view: ModelCapabilityView,
  size: CapabilitySize,
): { width: number; height: number } | null {
  // 能力行自己写了宽高就用它（视频行偶有 854x480 这类值）
  if (size.width !== null && size.height !== null) {
    return { width: size.width, height: size.height };
  }
  for (const key of [size.apiValue, size.id]) {
    if (!key) continue;
    if (view.defaultRatio) {
      const cell = matrixCell(view.matrix, key, view.defaultRatio);
      const pixels = cell === null ? null : parsePixels(cell);
      if (pixels !== null) return pixels;
    }
    const row = matchKey(view.matrix, key);
    if (row === null) continue;
    for (const cell of Object.values(row)) {
      const pixels = parsePixels(cell);
      if (pixels !== null) return pixels;
    }
  }
  return null;
}

/** 「2048x2048（419 万像素）」——价格表上给运营核对像素档用；取不到像素时为空串。 */
export function describePixels(pixels: { width: number; height: number } | null): string {
  if (pixels === null) return '';
  const total = pixels.width * pixels.height;
  const wan = total / 10_000;
  const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, '');
  return `${pixels.width}x${pixels.height}（${text} 万像素）`;
}

/**
 * 能力行里那一档的宽高字面值（尺寸表的预填值）。
 *
 * @returns `"1248x704"`；能力行里没有这一格时返回空串（**视频侧恒为空**：
 *          它的宽高只在定价目录里，见文件头）
 */
export function prefillDimensionValue(
  view: ModelCapabilityView,
  specKey: string,
): string {
  const pairs = new Map<string, string>();
  for (const pair of specKey.split('|')) {
    const at = pair.indexOf('=');
    if (at > 0) pairs.set(pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 1).trim());
  }
  const sizeKey = pairs.get('resolution') ?? pairs.get('size');
  const ratio = pairs.get('aspect_ratio');
  if (sizeKey === undefined || ratio === undefined) return '';
  return matrixCell(view.matrix, sizeKey, ratio) ?? '';
}
