import { writeAuditLog } from "../_lib/audit-log";

export type GenerationType = "image" | "video";

export type PricingRule = {
  id: string;
  generationType: GenerationType;
  modelId: string;
  modelName: string;
  /** e.g. { "resolution": "1920×1080", "count": 4 } → 匹配分辨率=1920×1080 */
  paramsSchema: Record<string, string | number>;
  baseCost: number;
  unit: string;
  description: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

let seed = 200;
function nextId(): string { return `pricing_${String(++seed)}`; }

export const MOCK_PRICING: PricingRule[] = [
  { id: "pricing_img_1", generationType: "image", modelId: "gpt-4o", modelName: "GPT-4o", paramsSchema: { resolution: "1280×960" }, baseCost: 2.5, unit: "张", description: "1280×960 图片 × 1", enabled: true, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "pricing_img_2", generationType: "image", modelId: "gpt-4o", modelName: "GPT-4o", paramsSchema: { resolution: "1920×1080" }, baseCost: 10, unit: "张", description: "1920×1080 图片 × 1", enabled: true, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "pricing_img_3", generationType: "image", modelId: "gpt-4o", modelName: "GPT-4o", paramsSchema: { resolution: "4096×2160" }, baseCost: 30, unit: "张", description: "4096×2160 图片 × 1", enabled: true, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "pricing_img_4", generationType: "image", modelId: "gpt-4o-mini", modelName: "GPT-4o Mini", paramsSchema: { resolution: "1280×960" }, baseCost: 0.5, unit: "张", description: "1280×960 图片 × 1", enabled: true, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "pricing_img_5", generationType: "image", modelId: "gpt-4o-mini", modelName: "GPT-4o Mini", paramsSchema: { resolution: "1920×1080" }, baseCost: 2.5, unit: "张", description: "1920×1080 图片 × 1", enabled: true, createdAt: "2026-06-01T08:00:00Z", updatedAt: "2026-07-20T10:00:00Z" },
  { id: "pricing_img_6", generationType: "image", modelId: "claude-fable-5", modelName: "Claude Fable 5", paramsSchema: { resolution: "1920×1080" }, baseCost: 12, unit: "张", description: "1920×1080 图片 × 1", enabled: true, createdAt: "2026-06-10T12:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "pricing_img_7", generationType: "image", modelId: "claude-fable-5", modelName: "Claude Fable 5", paramsSchema: { resolution: "4096×2160" }, baseCost: 35, unit: "张", description: "4096×2160 图片 × 1", enabled: true, createdAt: "2026-06-10T12:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "pricing_vid_1", generationType: "video", modelId: "claude-sonnet-5", modelName: "Claude Sonnet 5", paramsSchema: { resolution: "1920×1080" }, baseCost: 50, unit: "秒", description: "1920×1080 视频 × 1秒", enabled: true, createdAt: "2026-06-10T12:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "pricing_vid_2", generationType: "video", modelId: "claude-sonnet-5", modelName: "Claude Sonnet 5", paramsSchema: { resolution: "4096×2160" }, baseCost: 200, unit: "秒", description: "4096×2160 视频 × 1秒", enabled: true, createdAt: "2026-06-10T12:00:00Z", updatedAt: "2026-07-22T14:00:00Z" },
  { id: "pricing_vid_3", generationType: "video", modelId: "claude-opus-5", modelName: "Claude Opus 5", paramsSchema: { resolution: "1920×1080" }, baseCost: 100, unit: "秒", description: "1920×1080 视频 × 1秒", enabled: true, createdAt: "2026-06-10T12:00:00Z", updatedAt: "2026-07-25T09:00:00Z" },
  { id: "pricing_vid_4", generationType: "video", modelId: "claude-opus-5", modelName: "Claude Opus 5", paramsSchema: { resolution: "4096×2160" }, baseCost: 400, unit: "秒", description: "4096×2160 视频 × 1秒", enabled: false, createdAt: "2026-07-01T14:00:00Z", updatedAt: "2026-07-26T10:00:00Z" },
];

let rules = [...MOCK_PRICING];

export type PricingFormData = Pick<PricingRule, "generationType" | "modelId" | "modelName" | "paramsSchema" | "baseCost" | "unit" | "description" | "enabled">;

export function getPricingRules(): PricingRule[] { return [...rules]; }

export function createPricingRule(data: PricingFormData): PricingRule {
  const rule: PricingRule = { ...data, id: nextId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  rules.push(rule);
  writeAuditLog({ category: "pricing", action: "创建", target: `${data.modelName} — ${JSON.stringify(data.paramsSchema)}`, detail: `${data.baseCost} 积分/${data.unit}`, operator: "admin" });
  return rule;
}

export function updatePricingRule(id: string, data: PricingFormData): PricingRule | null {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rules[idx] = { ...rules[idx], ...data, updatedAt: new Date().toISOString() };
  writeAuditLog({ category: "pricing", action: "编辑", target: `${data.modelName} — ${JSON.stringify(data.paramsSchema)}`, detail: `${data.baseCost} 积分/${data.unit}`, operator: "admin" });
  return rules[idx];
}

export function deletePricingRule(id: string): boolean {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  writeAuditLog({ category: "pricing", action: "删除", target: rules[idx].modelName, detail: rules[idx].description, operator: "admin" });
  rules.splice(idx, 1);
  return true;
}

export function togglePricingRule(id: string): PricingRule | null {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rules[idx].enabled = !rules[idx].enabled;
  rules[idx].updatedAt = new Date().toISOString();
  writeAuditLog({ category: "pricing", action: rules[idx].enabled ? "启用" : "停用", target: rules[idx].modelName, detail: rules[idx].description, operator: "admin" });
  return rules[idx];
}

export type PreviewRequest = {
  generationType: GenerationType;
  modelId: string;
  params: Record<string, number | string>;
};

export type PreviewResult = {
  baseCost: number;
  multiplier: number;
  total: number;
  breakdown: string;
  ruleMatched: string;
  exactMatch: boolean;
};

export function calculatePreview(req: PreviewRequest): PreviewResult | null {
  const candidates = rules.filter(
    (r) => r.enabled && r.generationType === req.generationType && r.modelId === req.modelId
  );

  // Try exact match first
  const exact = candidates.find((r) =>
    Object.entries(r.paramsSchema).every(([k, v]) => req.params[k] === v)
  );

  const rule = exact || candidates[0];
  if (!rule) return null;

  // Calculate multiplier
  const multiplierKey = req.generationType === "image" ? "count" : "duration_seconds";
  const multiplier = Number(req.params[multiplierKey]) || 1;
  const total = rule.baseCost * multiplier;

  let breakdown = "";
  if (req.generationType === "image") {
    breakdown = `${req.params.count || 1}张 × ${rule.baseCost}积分/张 = ${total}积分`;
  } else {
    breakdown = `${req.params.duration_seconds || 1}秒 × ${rule.baseCost}积分/秒 = ${total}积分`;
  }

  return {
    baseCost: rule.baseCost,
    multiplier,
    total,
    breakdown,
    ruleMatched: rule.description,
    exactMatch: !!exact,
  };
}
