import {
  KNOWN_FEATURE_KEYS,
  camelFeatureKey,
  featureValueTypeOk,
  readFeature,
  type ModelType,
} from './model-form';
import type { KeyValueRow } from '../../lib/billing-catalog/catalogDraft';

export const FEATURE_BOOL_LABELS: Record<string, { label: string; types?: ModelType[] }> = {
  reference_image: { label: '参考图 reference_image', types: ['image', 'video'] },
  watermark: { label: '水印 watermark', types: ['image', 'video'] },
  stream: { label: '流式输出 stream', types: ['image'] },
  sequential_image_generation: { label: '顺序生成 sequential_image_generation', types: ['image'] },
  first_frame: { label: '首帧 first_frame', types: ['video'] },
  last_frame: { label: '尾帧 last_frame', types: ['video'] },
  first_last_frame: { label: '首尾帧 first_last_frame', types: ['video'] },
  audio: { label: '音频 audio', types: ['video'] },
  video_reference: { label: '视频素材参考 video_reference', types: ['video'] },
  audio_reference: { label: '音频素材参考 audio_reference', types: ['video'] },
  tools: { label: '工具调用 tools' },
  omni_reference_task_type: { label: '显式任务类型 omni_reference_task_type', types: ['video'] },
};

export const FEATURE_NUMBER_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  quantity_max: { label: '单次生成数量 quantity_max', types: ['image'], placeholder: '如 1' },
  max_prompt_length: {
    label: '提示词上限 max_prompt_length',
    types: ['image', 'video', 'text'],
    placeholder: '如 32000',
  },
  video_reference_max: { label: '视频参考上限 video_reference_max', types: ['video'], placeholder: '如 3' },
  audio_reference_max: { label: '音频参考上限 audio_reference_max', types: ['audio', 'video'], placeholder: '如 3' },
  image_reference_max: { label: '图片参考上限 image_reference_max', types: ['image', 'video', 'audio'], placeholder: '如 10' },
  max_reference_duration_sec: { label: '参考素材总时长上限秒 max_reference_duration_sec', types: ['video', 'audio'], placeholder: '如 15（留空 = 不限）' },
};

export const FEATURE_STRING_LABELS: Record<string, { label: string; types?: ModelType[]; placeholder: string }> = {
  i2i_model_name: {
    label: '图生图上游模型名 i2i_model_name',
    types: ['image'],
    placeholder: '如 gpt-image-2-edit（留空 = 不分流）',
  },
};

const FEATURE_KEY_BY_CAMEL = new Map(KNOWN_FEATURE_KEYS.map((key) => [camelFeatureKey(key), key]));

export const OBJECT_FEATURE_KEYS: ReadonlySet<string> = new Set(['task_types', 'video_dimensions']);

export const pretty = (raw: unknown) => {
  try {
    return JSON.stringify(raw ?? {}, null, 2);
  } catch {
    return '{}';
  }
};

export const pickFeatureBooleans = (features: Record<string, unknown> = {}): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(FEATURE_BOOL_LABELS)) out[key] = readFeature(features, key) === true;
  return out;
};

export const pickFeatureNumbers = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_NUMBER_LABELS)) {
    const v = readFeature(features, key);
    out[key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  }
  return out;
};

export const pickFeatureStrings = (features: Record<string, unknown> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FEATURE_STRING_LABELS)) {
    const v = readFeature(features, key);
    out[key] = typeof v === 'string' ? v : '';
  }
  return out;
};

export const dropKnownFeatures = (features: Record<string, unknown> = {}): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(features)) {
    const known = (KNOWN_FEATURE_KEYS as readonly string[]).includes(k) ? k : FEATURE_KEY_BY_CAMEL.get(k);
    if (known !== undefined && OBJECT_FEATURE_KEYS.has(known)) {
      if (v == null || (typeof v === 'object' && !Array.isArray(v))) continue;
    } else if (known && (v == null || featureValueTypeOk(known, v))) {
      continue;
    }
    out[k] = v;
  }
  return out;
};

export const readTaskTypesBase = (features?: Record<string, unknown>): Record<string, unknown> => {
  const raw = readFeature(features, 'task_types');
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
};

export const pickVideoDimensions = (features?: Record<string, unknown>): KeyValueRow[] => {
  const raw = readFeature(features, 'video_dimensions');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : String(value ?? ''),
  }));
};

export const buildVideoDimensions = (rows: KeyValueRow[]): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

export const omitEmptyStrings = (strs: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(strs)) {
    if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
};

export const omitEmpty = (nums: Record<string, string>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(nums)) {
    if (v.trim() === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
};

export const featureApplies = (meta: { types?: ModelType[] }, type: ModelType) =>
  !meta.types || meta.types.includes(type);
