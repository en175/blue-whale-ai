import {
  describePriceInHuman,
  mcToCredits,
  priceUnitLabel,
} from '../../utils/billing-catalog/catalogDraft';

export type PricingDraft =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parsePricingDraft(text: string): PricingDraft {
  if (!text.trim()) return { ok: false, error: '计价规则不能为空' };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '计价规则必须是 JSON 对象' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `计价规则不是合法 JSON：${error.message}` : '计价规则不是合法 JSON',
    };
  }
}

export function pricingEditorText(pricing: unknown): string {
  return JSON.stringify(pricing, null, 2) ?? '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unitLabel(pricing: Record<string, unknown>): string {
  const baseUnit = typeof pricing.baseUnit === 'string' ? pricing.baseUnit : '';
  const denominator = asNumber(pricing.unitDenominator) ?? 1;
  const label = priceUnitLabel({ baseUnit, unitDenominator: denominator });
  return label === '每 60 个秒' ? '分钟' : label;
}

function baseUnitNoun(pricing: Record<string, unknown>): string {
  const baseUnit = typeof pricing.baseUnit === 'string' ? pricing.baseUnit : '';
  if (baseUnit === 'usage.seconds') return '秒';
  if (baseUnit === 'usage.characters') return '字符';
  if (baseUnit === 'constant:1') return '次';
  return unitLabel(pricing);
}

function pricePart(basePrice: Record<string, unknown>, unit: string): string {
  if (basePrice.kind === 'table') {
    const table = asRecord(basePrice.table);
    const entries = Object.entries(table)
      .filter((entry): entry is [string, number] => asNumber(entry[1]) !== null)
      .map(([key, value]) => `${key} → ${mcToCredits(value)} 积分`);
    const by = Array.isArray(basePrice.by)
      ? basePrice.by.filter((axis): axis is string => typeof axis === 'string').join(' × ')
      : '';
    const head = by ? `${by} 分档` : '分档';
    return entries.length > 0
      ? `${head}（积分 / ${unit}）：${entries.join('；')}`
      : `${head}：未配置价格`;
  }
  const value = asNumber(basePrice.value);
  if (value === null) return '未配置价格';
  return describePriceInHuman(value, unit);
}

export function describePricing(pricing: unknown): string {
  const root = asRecord(pricing);
  const baseUnit = typeof root.baseUnit === 'string' ? root.baseUnit : '';
  if (!baseUnit) return '未识别的计价结构';
  const unit = unitLabel(root);
  const stepNoun = baseUnitNoun(root);
  const price = pricePart(asRecord(root.basePrice), unit);
  const notes: string[] = [];
  const step = asNumber(root.quantityStep);
  const offset = asNumber(root.quantityOffset);
  const minCredits = asNumber(root.minCredits);
  const maxCredits = asNumber(root.maxCredits);
  if (step !== null && step > 1) notes.push(`按 ${step} ${stepNoun}向上取整`);
  if (offset !== null && offset > 0) notes.push(`数量 +${offset} ${stepNoun}`);
  if (minCredits !== null) notes.push(`最低 ${minCredits} 积分`);
  if (maxCredits !== null) notes.push(`最高 ${maxCredits} 积分`);
  if (root.rounding === 'ceil') notes.push('向上取整');
  if (root.rounding === 'floor') notes.push('向下取整');
  return notes.length > 0 ? `${price}（${notes.join('，')}）` : price;
}
