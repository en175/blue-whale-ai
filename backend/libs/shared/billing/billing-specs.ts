




























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






  specs.reference_count = String(referenceList(input, taskType).length);
  const basisSeconds = input[DURATION_BASIS_KEY];
  if (typeof basisSeconds === "number" && Number.isFinite(basisSeconds)) {
    specs.duration = String(basisSeconds);
  }






  specs[VIDEO_TIER_KEY] = hasVideoInput(input) ? VIDEO_TIER_VALUES.with : VIDEO_TIER_VALUES.without;








  const videoInputSeconds = sumVideoInputSeconds(input.references);
  if (videoInputSeconds !== null) specs.video_input_seconds = String(videoInputSeconds);
  return specs;
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
    total += Math.floor(seconds);
  }
  return any ? total : null;
}
