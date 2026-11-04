import {
  KNOWN_FEATURE_KEYS,
  camelFeatureKey,
  featureValueTypeOk,
  readFeature,
} from './model-form';
import type { ModelType } from '@/admin/enums';
import { FEATURE_BOOL_LABELS, FEATURE_NUMBER_LABELS, FEATURE_STRING_LABELS } from '@/admin/enums';
import type { KeyValueRow } from '../../utils/billing-catalog/catalogDraft';

const FEATURE_KEY_BY_CAMEL = new Map(KNOWN_FEATURE_KEYS.map((key) => [camelFeatureKey(key), key]));

export const OBJECT_FEATURE_KEYS: ReadonlySet<string> = new Set(['task_types', 'video_dimensions']);

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
