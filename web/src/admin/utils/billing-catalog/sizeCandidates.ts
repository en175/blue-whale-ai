import type { AdminModel } from '@/admin/api/adminModels';

export interface CapabilitySize {
  id: string;
  label: string;
  apiValue: string;
  width: number | null;
  height: number | null;
}

export interface ModelCapabilityView {
  modelId: string;
  capabilityType: string;
  sizes: CapabilitySize[];
  ratios: string[];
  durations: string[];
  defaultRatio: string;
  matrix: Record<string, Record<string, string>>;
}

export interface SpecAxis {
  name: string;
  values: string[];
}

export const VIDEO_TIER_AXIS: SpecAxis = { name: 'video', values: ['0', '1'] };

const SIZE_AXIS_NAMES = ['size', 'resolution'];
const RATIO_AXIS_NAMES = ['aspect_ratio'];

export const DIMENSION_AXIS_NAMES = ['resolution', 'aspect_ratio'];

const AXIS_ORDER = ['resolution', 'size', 'aspect_ratio', 'video', 'duration'];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRatioId(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return readString((value as { id?: unknown }).id);
  }
  return '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

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
    apiValue: readString(o.apiValue ?? o.api_value),
    width: readNumber(o.width),
    height: readNumber(o.height),
  };
  return size.id ? size : null;
}

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
    .map(readRatioId)
    .filter((r) => r.length > 0);
  return {
    modelId,
    capabilityType: readString(model.capability_type),
    sizes,
    ratios,
    durations: readDurations(model.supported_durations),
    defaultRatio: readString(model.default_aspect_ratio),
    matrix: readMatrix(model.request_mapping),
  };
}

function readDurations(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return expandDurations(readNumber(raw[0]), readNumber(raw[1]), readNumber(raw[2]));
  }
  if (raw !== null && typeof raw === 'object') {
    const range = raw as Record<string, unknown>;
    return expandDurations(readNumber(range.min), readNumber(range.max), readNumber(range.step));
  }
  return [];
}

export function expandDurations(
  min: number | null,
  max: number | null,
  step: number | null,
): string[] {
  if (min === null || max === null) return [];
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) return [];
  const stride = step !== null && Number.isInteger(step) && step > 0 ? step : 1;
  const count = Math.floor((max - min) / stride) + 1;
  if (count < 1 || count > 120) return [];
  return Array.from({ length: count }, (_, index) => String(min + index * stride));
}

export function axisValues(view: ModelCapabilityView, axisName: string): string[] | null {
  const name = axisName.trim().toLowerCase();
  if (SIZE_AXIS_NAMES.includes(name)) {
    return view.sizes.map((s) => s.id).filter((id) => id.length > 0);
  }
  if (RATIO_AXIS_NAMES.includes(name)) return [...view.ratios];
  if (name === VIDEO_TIER_AXIS.name) return [...VIDEO_TIER_AXIS.values];
  if (name === 'image_reference') return ['0', '1'];
  if (name === 'duration') return [...view.durations];
  return null;
}

export function priceTableAxes(
  view: ModelCapabilityView,
  by: string[],
  existingKeys: string[],
): SpecAxis[] | null {
  const declared = by.length ? by : axesOfKeys(existingKeys);
  if (declared.length === 0) return null;
  const axes: SpecAxis[] = [];
  for (const name of declared) {
    const values = axisValues(view, name);
    if (values === null) return null;
    axes.push({ name: name.trim().toLowerCase(), values });
  }
  return sortAxes(axes);
}

export function axisValueLabel(view: ModelCapabilityView, axisName: string, value: string): string {
  const name = axisName.trim().toLowerCase();
  if (SIZE_AXIS_NAMES.includes(name)) {
    const size = view.sizes.find((item) => item.id.toLowerCase() === value.toLowerCase());
    return size !== undefined && size.label ? size.label : value;
  }
  if (name === 'image_reference') return value === '1' ? '有参考图' : '无参考图';
  if (name === VIDEO_TIER_AXIS.name) return value === '1' ? '含视频输入' : '不含视频输入';
  if (name === 'duration') return `${value} 秒`;
  return value;
}

function sortAxes(axes: SpecAxis[]): SpecAxis[] {
  return [...axes].sort((a, b) => {
    const ia = AXIS_ORDER.indexOf(a.name);
    const ib = AXIS_ORDER.indexOf(b.name);
    return (ia < 0 ? AXIS_ORDER.length : ia) - (ib < 0 ? AXIS_ORDER.length : ib);
  });
}

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

export function dimensionTableCandidates(view: ModelCapabilityView): string[] | null {
  const axes: SpecAxis[] = [];
  for (const name of DIMENSION_AXIS_NAMES) {
    const values = axisValues(view, name);
    if (values === null) return null;
    axes.push({ name, values });
  }
  return candidateSpecKeys(axes);
}

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

export function parsePixels(spec: string): { width: number; height: number } | null {
  const matched = /^(\d+)\s*[x×]\s*(\d+)$/.exec(spec.trim());
  if (matched === null) return null;
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function defaultAxesForBaseUnit(baseUnit: string): string[] {
  switch (baseUnit.trim()) {
    case 'usage.seconds':
      return ['resolution', VIDEO_TIER_AXIS.name];
    case 'usage.succeededSlots':
      return ['size'];
    default:
      return [];
  }
}

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

export function sizeOfSpecKey(
  view: ModelCapabilityView,
  specKey: string,
): CapabilitySize | null {
  const sizeId = axisValueInKey(specKey, 'size') || axisValueInKey(specKey, 'resolution');
  if (!sizeId) return null;
  const lower = sizeId.toLowerCase();
  return view.sizes.find((size) => size.id.toLowerCase() === lower) ?? null;
}

export function configuredSizePixels(
  view: ModelCapabilityView,
  size: CapabilitySize,
): { width: number; height: number } | null {
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

export function describePixels(pixels: { width: number; height: number } | null): string {
  if (pixels === null) return '';
  const total = pixels.width * pixels.height;
  const wan = total / 10_000;
  const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, '');
  return `${pixels.width}x${pixels.height}（${text} 万像素）`;
}

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
