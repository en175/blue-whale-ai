import type { AdminModel, CreateAdminModelParams, DurationRange, ModelSize } from '@/api/admin';

export type ModelType = 'image' | 'video' | 'text' | 'audio';

export const TYPE_TABS: { key: ModelType; label: string }[] = [
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'text', label: '文生文' },
  { key: 'audio', label: '音频' },
];

export const DEFAULT_PROVIDER_ID = 'new-api';

export const IMAGE_CHANNEL_PARSERS = ['seedream', 'gpt', 'banana'] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];

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
  sizes: ModelSize[];
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
  parser: ImageChannelParserId;
  gptMatrix: GptMatrix;
  bananaQuality: Record<string, string>;
  bananaSize: Record<string, string>;
};

export function isImageChannelParserId(value: string): value is ImageChannelParserId {
  return (IMAGE_CHANNEL_PARSERS as readonly string[]).includes(value);
}

export function isGptProviderSize(value: string): boolean {
  return (GPT_PROVIDER_SIZES as readonly string[]).includes(value);
}

export function emptyGptMatrix(sizes: ModelSize[], ratios: string[]): GptMatrix {
  const matrix: GptMatrix = {};
  for (const size of sizes) {
    if (!size.id.trim()) continue;
    matrix[size.id] = Object.fromEntries(ratios.map((ratio) => [ratio, '']));
  }
  return matrix;
}

export function parseGptMatrix(mapping: unknown, sizes: ModelSize[], ratios: string[]): GptMatrix {
  const base = emptyGptMatrix(sizes, ratios);
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return base;
  const matrix = (mapping as { matrix?: unknown }).matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return base;
  for (const [sizeId, row] of Object.entries(matrix as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    base[sizeId] = { ...(base[sizeId] ?? {}), ...(row as Record<string, string>) };
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

export function buildRequestMapping(form: FormSnapshot): unknown {
  if (form.type !== 'image' || form.parser === 'seedream') return null;
  if (form.parser === 'gpt') return { matrix: compactGptMatrix(form.gptMatrix) };
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
  const nums = [min, max, step].filter(Boolean).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  // IKG4UR：按**原形态**写回——数组行写数组、对象行写对象。
  // 两种形态在读侧语义不同（数组被 durationInRange 当档位列表用、对象当区间用），
  // 保存时若擅自改形态，会把该行的时长约束悄悄改掉（如 4–30 缩成 {1,4,30}）。
  // IKG4UR：两种形态都要求 min/max 成对——**先校验再分形态**。
  // 数组分支此前是早返回，只填最小秒会写出 `[5]`，正是本轮要消灭的形态；
  // 对象分支缺项则写 null（静默变成「不配时长」）——两者都不可接受，交调用方报错。
  if (nums.length < 2) return null;
  if (form.durationShape === 'array') return nums;
  const [minN, maxN, stepN] = nums;
  return stepN === undefined
    ? { min: minN, max: maxN }
    : { min: minN, max: maxN, step: stepN };
}

export function typeName(type: ModelType) {
  return TYPE_TABS.find((item) => item.key === type)?.label ?? type;
}

export function buildCreateParams(form: FormSnapshot): { ok: true; value: CreateAdminModelParams } | { ok: false; error: string } {
  if (!form.modelId.trim() || !form.label.trim()) {
    return { ok: false, error: '模型 ID、展示名为必填项。' };
  }
  if (form.type === 'image' && form.parser === 'gpt') {
    const gptErr = validateGptMatrix(form.gptMatrix);
    if (gptErr) return { ok: false, error: gptErr };
  }

  // IKG4UR：时长只对视频可配（音频上游无 duration 参数、库里已置 NULL）——
  // 在代码层钉死不变式「supported_durations 非空 ⟺ 该模型时长可配」。
  const durations = form.type === 'video' ? parseDurationFields(form) : null;
  // IKG4UR：**任一时长字段有值就必须成对**——原先的条件是 `min && max`，
  // 只在两端都填时才可能进入，而「只填一端」恰恰是它文案说的场景（条件恒假 = 校验形同虚设）：
  // 视频行清空「最大秒」会被静默存成「不配时长」（滑杆消失、服务端放行任意正数）。
  if (form.type === 'video' && (form.durationMin || form.durationMax || form.durationStep)) {
    if (durations == null) return { ok: false, error: '时长须为数字，且最小/最大需成对填写。' };
  }

  const sizes = form.type === 'text' || form.type === 'audio' ? [] : form.sizes.filter((s) => s.id.trim());
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
    default_size: form.type === 'image' || form.type === 'video' ? form.defaultSize.trim() || null : null,
    default_aspect_ratio: form.type === 'image' || form.type === 'video' ? form.defaultRatio.trim() || null : null,
    default_format: form.type === 'text' ? null : form.defaultFormat.trim() || null,
    default_duration: defaultDuration,
    features: form.features,
    enabled: form.enabled,
  };
  if (form.type === 'image') {
    params.channel_parser = form.parser;
    params.request_mapping = buildRequestMapping(form);
  }
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
  if ((created.default_size ?? null) !== (initial.default_size ?? null)) changes.default_size = created.default_size ?? null;
  if ((created.default_aspect_ratio ?? null) !== (initial.default_aspect_ratio ?? null)) {
    changes.default_aspect_ratio = created.default_aspect_ratio ?? null;
  }
  if ((created.default_format ?? null) !== (initial.default_format ?? null)) {
    changes.default_format = created.default_format ?? null;
  }
  if ((created.default_duration ?? null) !== (initial.default_duration ?? null)) {
    changes.default_duration = created.default_duration ?? null;
  }
  if (created.enabled !== initial.enabled) changes.enabled = created.enabled;
  if ((created.channel_parser ?? 'seedream') !== (initial.channel_parser ?? 'seedream')) {
    changes.channel_parser = created.channel_parser;
  }
  if (JSON.stringify(created.request_mapping ?? null) !== JSON.stringify(initial.request_mapping ?? null)) {
    changes.request_mapping = created.request_mapping ?? null;
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

export function parserFromModel(model?: AdminModel): ImageChannelParserId {
  const value = model?.channel_parser;
  return typeof value === 'string' && isImageChannelParserId(value) ? value : 'seedream';
}
