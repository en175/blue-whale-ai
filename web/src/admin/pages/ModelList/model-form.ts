import type { AdminModel, CreateAdminModelParams, DurationRange, ModelSize } from '@/admin/api/adminModels';
import { TYPE_TABS, type ModelType } from '@/admin/enums';

export interface SizeForm {
  id: string;
  label?: string;
}

export interface RatioForm {
  id: string;
  label?: string;
}


export type ModelSizeWire = ModelSize & Record<string, unknown>;



export function camelFeatureKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}


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





  'task_types',




  'video_dimensions',
] as const;


export const TASK_TYPE_KEYS = ['text2video', 'omni', 'image_reference', 'first_frame', 'first_last_frame', 'edit', 'extend'] as const;
export type TaskTypeKey = (typeof TASK_TYPE_KEYS)[number];

export type TaskTypeDurationStrategy = 'follow' | 'auto-or-specified' | 'specified';

export const TASK_TYPE_DURATION_OPTIONS: { value: TaskTypeDurationStrategy; label: string }[] = [
  { value: 'specified', label: '指定秒数' },
  { value: 'follow', label: '仅自动' },
  { value: 'auto-or-specified', label: '自动或指定' },
];

export const DEFAULT_PROVIDER_ID = 'new-api';


export const IMAGE_CHANNEL_PARSERS = ['seedream', 'gpt', 'banana'] as const;
export type ImageChannelParserId = (typeof IMAGE_CHANNEL_PARSERS)[number];


export const IMAGE_PROTOCOLS = ['inline-image', 'openai-images'] as const;
export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];

export const CHANNEL_MEDIA = ['image', 'video', 'audio', 'text'] as const;
export type ChannelMedia = (typeof CHANNEL_MEDIA)[number];
















export interface ChannelOption {
  id: string;
  label: string;
  media: ChannelMedia;

  parser: ImageChannelParserId | null;

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


export function isChannelId(value: unknown): value is ChannelId {
  return typeof value === 'string' && CHANNELS.some((channel) => channel.id === value);
}


export function channelOf(id: ChannelId): ChannelOption {
  return CHANNELS.find((channel) => channel.id === id) ?? CHANNELS[0];
}




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



export function parseStoredChannel(raw: unknown, capabilityType: unknown): ChannelId {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (isChannelId(normalized)) return normalized;
  }
  return defaultChannelFor(capabilityType);
}


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

export const DEFAULT_IMAGE_RATIOS: RatioForm[] = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4'].map(
  (id) => ({ id }),
);

export type GptMatrix = Record<string, Record<string, string>>;

export type FormSnapshot = {
  type: ModelType;
  modelId: string;
  label: string;
  icon: string;
  sizes: SizeForm[];
  ratios: RatioForm[];
  durationMin: string;
  durationMax: string;
  durationStep: string;



  durationShape: 'array' | 'object';
  formats: string[];
  defaultSize: string;
  defaultRatio: string;
  defaultFormat: string;
  defaultDuration: string;
  enabled: boolean;
  features: Record<string, unknown>;


  channel: ChannelId;


  originalChannel: ChannelId;


  originalHadRequestMapping: boolean;
  gptMatrix: GptMatrix;


  seedreamMatrix: GptMatrix;
  bananaQuality: Record<string, string>;
  bananaSize: Record<string, string>;







  pricing?: unknown;
};

export function isImageChannelParserId(value: string): value is ImageChannelParserId {
  return (IMAGE_CHANNEL_PARSERS as readonly string[]).includes(value);
}

export function isGptProviderSize(value: string): boolean {
  return (GPT_PROVIDER_SIZES as readonly string[]).includes(value);
}

export function emptyGptMatrix(sizes: SizeForm[], ratios: RatioForm[]): GptMatrix {
  const ratioIds = ratios.map((ratio) => ratio.id);
  const matrix: GptMatrix = {};
  for (const size of sizes) {
    if (!size.id.trim()) continue;
    matrix[size.id] = Object.fromEntries(ratioIds.map((ratioId) => [ratioId, '']));
  }
  return matrix;
}




export function mergeMatrix(prev: GptMatrix, sizes: SizeForm[], ratios: RatioForm[]): GptMatrix {
  const rebuilt = emptyGptMatrix(sizes, ratios);
  const ratioIds = ratios.map((ratio) => ratio.id);
  for (const [sizeId, row] of Object.entries(prev)) {
    const target = rebuilt[sizeId];
    if (!target) continue;
    for (const ratioId of ratioIds) {
      const cell = row[ratioId];
      if (cell !== undefined) target[ratioId] = cell;
    }
  }
  return rebuilt;
}



export function sizesFromModel(raw: unknown): SizeForm[] {
  if (!Array.isArray(raw)) return [];
  const out: SizeForm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    out.push({
      id: typeof o.id === 'string' ? o.id : '',
      label: typeof o.label === 'string' ? o.label : '',
    });
  }
  return out;
}



export function sizeToWire(size: SizeForm): ModelSizeWire {
  const id = size.id.trim();
  const out: ModelSizeWire = { id, api_value: id };
  const label = (size.label ?? '').trim();
  if (label) out.label = label;
  return out;
}

export function ratiosFromModel(raw: unknown): RatioForm[] {
  if (!Array.isArray(raw)) return [];
  const out: RatioForm[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item) out.push({ id: item });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id) continue;
    const label = typeof o.label === 'string' && o.label.trim() && o.label !== o.id ? o.label : '';
    out.push({ id: o.id, label });
  }
  return out;
}

export function ratioToWire(ratio: RatioForm): { id: string; label?: string } {
  const id = ratio.id.trim();
  const label = (ratio.label ?? '').trim();
  return label && label !== id ? { id, label } : { id };
}






function matchFormKey(formKeys: string[], raw: string): string | undefined {
  if (formKeys.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  return formKeys.find((key) => key.toLowerCase() === lower);
}

export function parseGptMatrix(mapping: unknown, sizes: SizeForm[], ratios: RatioForm[]): GptMatrix {
  const base = emptyGptMatrix(sizes, ratios);
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return base;
  const matrix = (mapping as { matrix?: unknown }).matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) return base;
  const sizeIds = sizes.map((size) => size.id).filter((id) => id.trim());
  const ratioIds = ratios.map((ratio) => ratio.id);
  for (const [rawSizeId, row] of Object.entries(matrix as Record<string, unknown>)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;

    const sizeId = matchFormKey(sizeIds, rawSizeId) ?? rawSizeId;
    const cells: Record<string, string> = {};
    for (const [rawRatio, cell] of Object.entries(row as Record<string, string>)) {
      cells[matchFormKey(ratioIds, rawRatio) ?? rawRatio] = cell;
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










export function buildRequestMapping(
  form: FormSnapshot,
  parser: ImageChannelParserId = channelOf(form.channel).parser ?? 'seedream',
): unknown | undefined {
  if (form.type !== 'image') return undefined;
  if (parser === 'seedream') {


    const matrix = compactGptMatrix(form.seedreamMatrix);
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



  if (!min || !max) return null;
  const minN = Number(min);
  const maxN = Number(max);
  if (!Number.isInteger(minN) || !Number.isInteger(maxN) || minN < 0 || maxN < 0) return null;
  if (minN > maxN) return null;
  const stepN = step ? Number(step) : undefined;
  if (stepN !== undefined && (!Number.isFinite(stepN) || stepN <= 0)) return null;



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


    if (originalParser === 'seedream' && form.originalHadRequestMapping && !Object.keys(compactGptMatrix(form.seedreamMatrix)).length) {
      return {
        ok: false,
        error: 'Seedream 尺寸矩阵不能整张清空（清空后该模型出站尺寸会回落成 provider 原值，上游会 400）。至少保留一格。',
      };
    }
  }



  const durations = form.type === 'video' ? parseDurationFields(form) : null;



  if (form.type === 'video' && (form.durationMin || form.durationMax || form.durationStep)) {
    if (durations == null) {
      return {
        ok: false,
        error: '时长须填非负整数，且最小 / 最大需成对填写、最小不得大于最大；步长（选填）须为正数。',
      };
    }
  }

  const sizes = form.type === 'text' || form.type === 'audio' ? [] : form.sizes.filter((s) => s.id.trim()).map(sizeToWire);
  const ratios =
    form.type === 'text' || form.type === 'audio'
      ? []
      : form.ratios.filter((ratio) => ratio.id.trim()).map(ratioToWire);
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


    default_size: form.type === 'image' || form.type === 'video' ? form.defaultSize.trim() : '',
    default_aspect_ratio: form.type === 'image' || form.type === 'video' ? form.defaultRatio.trim() : '',
    default_format: form.type === 'text' ? null : form.defaultFormat.trim() || null,
    default_duration: defaultDuration,
    features: form.features,
    enabled: form.enabled,
  };
  if (form.type === 'image') {

    params.channel = form.channel;


    const mapping = buildRequestMapping(form, parser);
    if (mapping !== undefined) params.request_mapping = mapping;
  }


  if (form.pricing !== undefined) params.pricing = form.pricing;
  return { ok: true, value: params };
}




function sizesForDiff(raw: unknown): string {
  const rows = Array.isArray(raw) ? raw : [];
  return JSON.stringify(
    rows.map((item) => {
      const o = (item ?? {}) as Record<string, unknown>;
      return [
        typeof o.id === 'string' ? o.id.trim() : '',
        typeof o.label === 'string' ? o.label.trim() : '',
      ];
    }),
  );
}

function ratiosForDiff(raw: unknown): string {
  return JSON.stringify(
    ratiosFromModel(raw).map((ratio) => [ratio.id, ratio.label || ratio.id]),
  );
}

export function diffUpdateParams(
  initial: AdminModel,
  created: CreateAdminModelParams,
): Partial<CreateAdminModelParams> {
  const changes: Partial<CreateAdminModelParams> = {};
  if (created.model_label !== initial.model_label) changes.model_label = created.model_label;
  if ((created.icon ?? null) !== (initial.icon ?? null)) changes.icon = created.icon ?? null;
  if (sizesForDiff(created.supported_sizes) !== sizesForDiff(initial.supported_sizes)) {
    changes.supported_sizes = created.supported_sizes;
  }
  if (
    ratiosForDiff(created.supported_aspect_ratios) !==
    ratiosForDiff(initial.supported_aspect_ratios)
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


  if (
    parseStoredChannel(created.channel, initial.capability_type) !==
    parseStoredChannel(initial.channel, initial.capability_type)
  ) {
    changes.channel = created.channel;
  }


  const mappingChanged =
    created.request_mapping !== undefined &&
    JSON.stringify(created.request_mapping) !== JSON.stringify(initial.request_mapping ?? null);
  if (mappingChanged) {
    changes.request_mapping = created.request_mapping;
  }






  if (mappingChanged) {
    changes.supported_sizes = created.supported_sizes;
  }



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
  return channelOf(channelFromModel(model)).parser ?? 'seedream';
}



export function channelFromModel(model?: AdminModel): ChannelId {
  return parseStoredChannel(model?.channel, model?.capability_type);
}




export function readFeature(features: Record<string, unknown> | undefined, key: string): unknown {
  if (!features) return undefined;
  const snake = features[key];
  return snake !== undefined ? snake : features[camelFeatureKey(key)];
}



export function hasFeatureKey(features: Record<string, unknown> | undefined, key: string): boolean {
  if (!features) return false;
  return key in features || camelFeatureKey(key) in features;
}



const FEATURE_NUMBER_KEYS = new Set([
  'image_reference_max',
  'quantity_max',
  'max_prompt_length',
  'video_reference_max',
  'audio_reference_max',
  'max_reference_duration_sec',
]);




const FEATURE_STRING_KEYS = new Set(['i2i_model_name']);

export function featureValueTypeOk(key: string, value: unknown): boolean {
  if (FEATURE_NUMBER_KEYS.has(key)) return typeof value === 'number' && Number.isFinite(value);
  if (FEATURE_STRING_KEYS.has(key)) return typeof value === 'string';
  return typeof value === 'boolean';
}

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

export function pickTaskTypeEnabled(features: Record<string, unknown> | undefined): Record<string, boolean> {
  const raw = readFeature(features, 'task_types');
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const taskType of TASK_TYPE_KEYS) {
    out[taskType] = Object.prototype.hasOwnProperty.call(map, taskType);
  }
  return out;
}

export function pickTaskTypeDuration(features: Record<string, unknown> | undefined): Record<string, TaskTypeDurationStrategy> {
  const raw = readFeature(features, 'task_types');
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, TaskTypeDurationStrategy> = {};
  for (const taskType of TASK_TYPE_KEYS) {
    const entry = map[taskType];
    const record =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const durations = record?.allowed_durations;
    if (Array.isArray(durations) && durations.length === 1 && durations[0] === -1) {
      out[taskType] = 'follow';
    } else if (record?.allow_auto_duration === true) {
      out[taskType] = 'auto-or-specified';
    } else {
      out[taskType] = 'specified';
    }
  }
  return out;
}

export function buildTaskTypes(
  base: Record<string, unknown>,
  ratios: Record<string, string[]>,
  enabled: Record<string, boolean>,
  duration: Record<string, TaskTypeDurationStrategy> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const taskType of TASK_TYPE_KEYS) {
    if (!enabled[taskType]) continue;
    const list = (ratios[taskType] ?? []).map((s) => s.trim()).filter(Boolean);
    const entry = base[taskType];
    const rest =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? { ...(entry as Record<string, unknown>) }
        : {};
    delete rest.allowed_ratios;
    delete rest.allowed_durations;
    delete rest.allow_auto_duration;
    const next: Record<string, unknown> = { ...rest };
    if (list.length) next.allowed_ratios = list;
    const strategy = duration[taskType] ?? 'specified';
    if (strategy === 'follow') next.allowed_durations = [-1];
    else if (strategy === 'auto-or-specified') next.allow_auto_duration = true;
    out[taskType] = next;
  }
  return out;
}
