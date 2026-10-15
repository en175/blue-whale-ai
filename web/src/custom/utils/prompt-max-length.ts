import { fetchGenerationModels, type ModelCapability } from '@/custom/api/generation';

export function promptMaxLengthOf(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return null;
}

export function isPromptOverLimit(text: string, raw: unknown): boolean {
  const max = promptMaxLengthOf(raw);
  return max != null && text.length > max;
}

export function promptOverLimitMessage(max: number): string {
  return `当前参考提示词内容超出${max}字限制，请重新编辑。`;
}

export function composedPromptLimitError(text: string, raw: unknown): string | null {
  const max = promptMaxLengthOf(raw);
  if (max == null || text.length <= max) return null;
  return promptOverLimitMessage(max);
}

export function promptCharCountLabel(length: number, max: number | null): string {
  return max == null ? String(length) : `${length}/${max}`;
}

export async function promptMaxLengthOfModel(
  capability: ModelCapability,
  modelId: string,
): Promise<number | null> {
  if (!modelId) return null;
  const models = await fetchGenerationModels(capability);
  return promptMaxLengthOf(models.find((model) => model.model_id === modelId)?.features?.max_prompt_length);
}
