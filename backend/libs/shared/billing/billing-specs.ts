




























import { FROZEN_VIDEO_MODE_KEY } from "@lib/contracts";

export const DURATION_BASIS_KEY = "duration_basis_seconds";

export const OMNI_TASK_TYPE_ALLOWED_KEY = "omni_reference_task_type_allowed";

const NON_SPEC_FIELDS = new Set([
  "prompt",
  "title",
  "provider_credential",
  DURATION_BASIS_KEY,
  OMNI_TASK_TYPE_ALLOWED_KEY,
]);









export const VIDEO_TIER_KEY = 'video';










export const VIDEO_TIER_VALUES = { without: '0', with: '1' } as const;


function hasVideoInput(input: Record<string, unknown>): boolean {
  return (
    Array.isArray(input.references) &&
    input.references.some(
      (ref) =>
        typeof ref === 'object' && ref !== null && (ref as { type?: unknown }).type === 'video',
    )
  );
}

















export function extractSpecs(
  input: Record<string, unknown>,
  taskType: string,
): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (NON_SPEC_FIELDS.has(key.toLowerCase())) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      specs[key.toLowerCase()] = String(value).toLowerCase();
    }
  }






  const references = referenceList(input, taskType);
  specs.reference_count = String(references.length);
  if (taskType === 'image') {
    specs.image_reference = references.length > 0 ? '1' : '0';
  }
  const basisSeconds = input[DURATION_BASIS_KEY];
  if (typeof basisSeconds === "number" && Number.isFinite(basisSeconds)) {
    specs.duration = String(basisSeconds);
  }






  specs[VIDEO_TIER_KEY] = hasVideoInput(input) ? VIDEO_TIER_VALUES.with : VIDEO_TIER_VALUES.without;








  const editMode = input[FROZEN_VIDEO_MODE_KEY] === 'edit';
  if (editMode) {
    specs.reference_seconds = '0';
  } else {
    const videoInputSeconds = sumVideoInputSeconds(input.references);
    if (videoInputSeconds !== null) {
      specs.reference_seconds = String(videoInputSeconds);
    }
  }

  const prompt = input.prompt;
  if (typeof prompt === 'string') {
    specs.prompt_characters = String(countPromptCharacters(prompt));
  }

  if (editMode) specs.video_edit = '1';
  return specs;
}

export function countPromptCharacters(prompt: string): number {
  return Array.from(prompt).filter((c) => !/\s/.test(c)).length;
}
























export function referenceList(input: Record<string, unknown>, taskType: string): unknown[] {
  if (taskType === 'image' && Array.isArray(input.input_asset_ids)) {
    return input.input_asset_ids;
  }
  return Array.isArray(input.references) ? input.references : [];
}









export function sumVideoInputSeconds(references: unknown): number | null {
  if (!Array.isArray(references)) return null;
  let total = 0;
  let any = false;
  for (const ref of references) {
    if (typeof ref !== 'object' || ref === null) continue;
    const entry = ref as { type?: unknown; duration?: unknown };
    if (entry.type !== 'video') continue;
    any = true;
    const seconds = entry.duration;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    total += seconds;
  }
  return any ? Math.round(total) : null;
}
