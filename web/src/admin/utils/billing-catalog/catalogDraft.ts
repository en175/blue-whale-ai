
export type CatalogDocumentJson = Record<string, unknown>;

export interface CatalogRuleView {
  usageSemantic?: unknown;
  baseUnit?: unknown;
  basePrice?: {
    kind?: unknown;
    value?: unknown;
    by?: unknown;
    table?: Record<string, unknown>;
  };
  dims?: Record<string, unknown>;
  multipliers?: Record<string, unknown>;
  dimPrices?: Record<string, unknown>;
  unitDenominator?: unknown;
  minCredits?: unknown;
  maxCredits?: unknown;
  rounding?: unknown;
}


export function parseCatalog(text: string): CatalogDocumentJson {
  if (!text.trim()) return siteCatalogDocument(DEFAULT_CREDITS_PER_YUAN, DEFAULT_DISCOUNT_POLICY);
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('目录文档必须是 JSON 对象');
    }
    return parsed as CatalogDocumentJson;
  } catch (e) {
    throw new Error(e instanceof Error ? `目录文档不是合法 JSON：${e.message}` : '目录文档不是合法 JSON');
  }
}

export const DEFAULT_CREDITS_PER_YUAN = 15;

const DEFAULT_DISCOUNT_POLICY: DiscountPolicyView = { stackMode: 'multiply', floorFactorBp: 3000 };

export function serializeCatalog(doc: CatalogDocumentJson): string {
  return JSON.stringify(doc);
}

export function isCatalogDirty(
  draft: CatalogDocumentJson,
  baseline: CatalogDocumentJson,
): boolean {
  return serializeCatalog(draft) !== serializeCatalog(baseline);
}


export function readCreditsPerYuan(doc: CatalogDocumentJson): number | null {
  const raw = doc.creditsPerYuan;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function withCreditsPerYuan(
  doc: CatalogDocumentJson,
  creditsPerYuan: number | null,
): CatalogDocumentJson {
  return { ...clone(doc), creditsPerYuan };
}

export interface DiscountPolicyView {
  stackMode: string;
  floorFactorBp: number;
}

export function readDiscountPolicy(doc: CatalogDocumentJson): DiscountPolicyView {
  const raw = doc.discountPolicy;
  const policy = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    stackMode: typeof policy.stackMode === 'string' && policy.stackMode ? policy.stackMode : 'multiply',
    floorFactorBp:
      typeof policy.floorFactorBp === 'number' && Number.isFinite(policy.floorFactorBp)
        ? policy.floorFactorBp
        : 3000,
  };
}

export function withDiscountPolicy(
  doc: CatalogDocumentJson,
  patch: Partial<DiscountPolicyView>,
): CatalogDocumentJson {
  const next = clone(doc);
  const current = next.discountPolicy;
  const merged = current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  next.discountPolicy = { ...merged, ...patch };
  return next;
}

const SITE_CATALOG_SKELETON: CatalogDocumentJson = {
  schemaVersion: 1,
  currency: 'CNY',
  creditsPerYuan: null,
  discountPolicy: DEFAULT_DISCOUNT_POLICY,
};

export function siteCatalogDocument(
  creditsPerYuan: number | null,
  policy: DiscountPolicyView,
): CatalogDocumentJson {
  return withDiscountPolicy(withCreditsPerYuan(SITE_CATALOG_SKELETON, creditsPerYuan), policy);
}


export function creditsToMc(credits: number): number {
  return Math.round(credits * 1000);
}

export function mcToCredits(mc: number): string {
  return trimTrailingZeros((mc / 1000).toFixed(3));
}

function trimTrailingZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export type PriceKind = 'const' | 'table' | 'unset';

export interface KeyValueRow {
  key: string;
  value: string;
}

export interface MoneyField {
  value: string;
  originalMc: number | null;
}

export interface PriceRow extends KeyValueRow, MoneyField {}

export interface DimPriceRow extends KeyValueRow, MoneyField {
  firstFree: boolean;
  originalSpec: Record<string, unknown> | null;
}

export interface RuleForm {
  modelId: string;
  taskType: string;
  baseUnit: string;
  priceKind: PriceKind;
  priceValue: MoneyField;
  priceTable: PriceRow[];
  dims: KeyValueRow[];
  multipliers: KeyValueRow[];
  dimPrices: DimPriceRow[];
  unitDenominator: string;
  minCredits: string;
  maxCredits: string;
  rounding: string;
}

export const BASE_UNIT_OPTIONS = [
  { value: 'constant:1', label: 'constant:1（按次）' },
  { value: 'usage.succeededSlots', label: 'usage.succeededSlots（成功槽数）' },
  { value: 'usage.seconds', label: 'usage.seconds（秒）' },
  { value: 'usage.characters', label: 'usage.characters（字符）' },
  { value: 'usage.referenceCount', label: 'usage.referenceCount（参考素材数）' },
  { value: 'usage.referenceSeconds', label: 'usage.referenceSeconds（参考视频秒数）' },
  { value: 'usage.videoEdit', label: 'usage.videoEdit（编辑模式标记）' },
];

const WHOLE_NUMBER = /^\d+$/;
const MONEY = /^\d+(\.\d+)?$/;

function parseWhole(raw: string): number | null {
  const trimmed = raw.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  return MONEY.test(trimmed) ? Number(trimmed) : null;
}

function rowsError(rows: KeyValueRow[], field: string): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return `${field}的键不能为空`;
    if (parseWhole(row.value) === null) return `${field}「${key}」的值必须是整数`;
  }
  return null;
}

function priceRowsError(rows: PriceRow[], field: string): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return `${field}的键不能为空`;
    if (row.value.trim() === '') return `${field}「${key}」还没填价`;
    if (parseMoney(row.value) === null) {
      return `${field}「${key}」的单价必须是一个数（单位：积分 / 每 unitDenominator 个单位，如 70 或 0.12）`;
    }
  }
  return null;
}

function dimPriceRowsError(rows: DimPriceRow[]): string | null {
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) return '维度绝对加价的维度不能为空';
    if (parseMoney(row.value) === null) {
      return `维度绝对加价「${key}」的单价必须是一个数（单位：积分 / 每个单位，如 0.02）`;
    }
    if (fieldToMc(row) <= 0) {
      return `维度绝对加价「${key}」的单价必须大于 0（要让这个维度免费就整行删掉，别写 0）`;
    }
  }
  return null;
}

export function ruleFormError(form: RuleForm): string | null {
  if (!form.modelId.trim()) return '模型 ID 必填';
  if (!form.taskType.trim()) return '任务类型必填';
  if (!form.baseUnit.trim()) return '基准维度必填';

  const hasDimPrices = form.dimPrices.some((row) => row.key.trim() !== '');

  if (form.priceKind === 'const') {
    if (parseMoney(form.priceValue.value) === null) {
      return '基准单价必填，且是一个数（单位：积分 / 每 unitDenominator 个单位，如 70）';
    }
  } else if (form.priceKind === 'table') {
    if (form.priceTable.length === 0) return '价格表至少要有一行（规格键 → 单价）';
    const priceError = priceRowsError(form.priceTable, '价格表');
    if (priceError !== null) return priceError;
  }

  const weightsError = rowsError([...form.dims, ...form.multipliers], '维度表');
  if (weightsError !== null) return weightsError;

  const dimPricesError = dimPriceRowsError(form.dimPrices);
  if (dimPricesError !== null) return dimPricesError;

  if (hasDimPrices && form.maxCredits.trim()) {
    return '维度绝对加价与积分上限不能同时配：上限计价算不到这份加价，预扣会冻少、'
      + '结算超出后只记应收（少收且静默）。二选一';
  }

  if (form.unitDenominator.trim() && parseWhole(form.unitDenominator) === null) {
    return '单位分母必须是整数（1 = 每秒/每张）';
  }
  if (form.minCredits.trim() && parseWhole(form.minCredits) === null) return '积分下限必须是整数';
  if (form.maxCredits.trim() && parseWhole(form.maxCredits) === null) return '积分上限必须是整数';
  return null;
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    out[key] = parseWhole(row.value) ?? 0;
  }
  return out;
}

function fieldToMc(field: MoneyField): number {
  if (field.originalMc !== null && field.value.trim() === mcToCredits(field.originalMc)) {
    return field.originalMc;
  }
  const credits = parseMoney(field.value);
  if (credits === null) return field.originalMc ?? 0;
  return creditsToMc(credits);
}

export function ruleFromForm(
  form: RuleForm,
  original: CatalogRuleView,
): CatalogRuleView {
  let basePrice: CatalogRuleView['basePrice'];
  if (form.priceKind === 'const') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'const',
      value: fieldToMc(form.priceValue),
    };
  } else if (form.priceKind === 'table') {
    basePrice = {
      ...(original.basePrice ?? {}),
      kind: 'table',
      value: null,
      table: priceRowsToRecord(form.priceTable),
    };
  } else {
    basePrice = {
      ...(Array.isArray(original.basePrice?.by) ? { by: original.basePrice.by } : {}),
      kind: 'unset',
    };
  }

  const rule: CatalogRuleView = {
    ...original,
    baseUnit: form.baseUnit.trim(),
    basePrice,
    unitDenominator: form.unitDenominator.trim() ? parseWhole(form.unitDenominator) : 1,
    minCredits: form.minCredits.trim() ? parseWhole(form.minCredits) : 1,
    rounding: form.rounding,
  };

  const dims = rowsToRecord(form.dims);
  const multipliers = rowsToRecord(form.multipliers);
  if (Object.keys(dims).length > 0) rule.dims = dims;
  else delete rule.dims;
  if (Object.keys(multipliers).length > 0) rule.multipliers = multipliers;
  else delete rule.multipliers;

  const dimPrices = dimPriceRowsToRecord(form.dimPrices);
  if (Object.keys(dimPrices).length > 0) rule.dimPrices = dimPrices;
  else delete rule.dimPrices;

  rule.maxCredits = form.maxCredits.trim() ? parseWhole(form.maxCredits) : null;

  return rule;
}

export function formFromRule(
  modelId: string,
  taskType: string,
  rule: CatalogRuleView,
): RuleForm {
  const price = rule.basePrice ?? {};
  const kind: PriceKind =
    price.kind === 'table' ? 'table' : price.kind === 'unset' ? 'unset' : 'const';
  const table = price.table !== undefined && price.table !== null ? price.table : {};
  const asText = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const asCredits = (v: unknown): MoneyField => {
    const mc = typeof v === 'number' && Number.isFinite(v) ? v : null;
    return { value: mc === null ? '' : mcToCredits(mc), originalMc: mc };
  };

  return {
    modelId,
    taskType,
    baseUnit: typeof rule.baseUnit === 'string' ? rule.baseUnit : '',
    priceKind: kind,
    priceValue: asCredits(price.value),
    priceTable: Object.entries(table).map(([key, value]) => ({
      key,
      ...asCredits(value),
    })),
    dims: recordToRows(rule.dims),
    multipliers: recordToRows(rule.multipliers),
    dimPrices: recordToDimPriceRows(rule.dimPrices),
    unitDenominator: asText(rule.unitDenominator ?? 1),
    minCredits: asText(rule.minCredits ?? 1),
    maxCredits: asText(rule.maxCredits),
    rounding: typeof rule.rounding === 'string' && rule.rounding ? rule.rounding : 'halfUp',
  };
}

export function emptyRuleForm(): RuleForm {
  return {
    modelId: '',
    taskType: '',
    baseUnit: 'constant:1',
    priceKind: 'const',
    priceValue: { value: '', originalMc: null },
    priceTable: [{ key: '', value: '', originalMc: null }],
    dims: [],
    multipliers: [],
    dimPrices: [],
    unitDenominator: '1',
    minCredits: '1',
    maxCredits: '',
    rounding: 'halfUp',
  };
}

function priceRowsToRecord(rows: PriceRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    out[key] = fieldToMc(row);
  }
  return out;
}

function recordToRows(record: Record<string, unknown> | undefined): KeyValueRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: typeof value === 'number' && Number.isFinite(value) ? String(value) : String(value ?? ''),
  }));
}


function recordToDimPriceRows(
  record: Record<string, unknown> | undefined,
): DimPriceRow[] {
  if (!record || typeof record !== 'object') return [];
  return Object.entries(record).map(([key, raw]) => {
    const spec = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const mc = typeof spec.unitMc === 'number' && Number.isFinite(spec.unitMc) ? spec.unitMc : null;
    return {
      key,
      value: mc === null ? '' : mcToCredits(mc),
      originalMc: mc,
      firstFree: spec.firstFree === true,
      originalSpec: spec,
    };
  });
}

function dimPriceRowsToRecord(
  rows: DimPriceRow[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (key in out) throw new Error(`键重复：${key}`);
    const spec: Record<string, unknown> = {
      ...(row.originalSpec ?? {}),
      unitMc: fieldToMc(row),
    };
    if (row.firstFree) spec.firstFree = true;
    else delete spec.firstFree;
    out[key] = spec;
  }
  return out;
}


export function priceUnitLabel(rule: CatalogRuleView): string {
  const denom = typeof rule.unitDenominator === 'number' && rule.unitDenominator > 0
    ? rule.unitDenominator
    : 1;
  const unit = typeof rule.baseUnit === 'string' ? rule.baseUnit : '';
  const name =
    unit === 'constant:1' ? '次'
    : unit === 'usage.seconds' ? '秒'
    : unit === 'usage.succeededSlots' ? '张'
    : unit === 'usage.characters' ? '字符'
    : unit === 'usage.referenceCount' ? '参考素材'
    : '';
  if (!name) return `${denom} 个单位`;
  return denom === 1 ? name : `每 ${denom} 个${name}`;
}

export function describePriceInHuman(
  mc: number,
  unitLabel = '',
): string {
  return `${mcToCredits(mc)} 积分${unitLabel ? ` / ${unitLabel}` : ''}`;
}

function clone(doc: CatalogDocumentJson): CatalogDocumentJson {
  return JSON.parse(JSON.stringify(doc)) as CatalogDocumentJson;
}
