








import {
  ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION,
  ERROR_CAPABILITY_UNSUPPORTED_RATIO,
  ERROR_CAPABILITY_UNSUPPORTED_DURATION,
  ERROR_TASK_TYPE_PARAM_CONSTRAINT,
  ERROR_CODES,
  errorCodeToNumeric,
} from "./error-codes.js";


export interface CapabilityLimitInput {
  supported_sizes: Array<{ id?: string; api_value?: string }>;
  supported_aspect_ratios: unknown;
  supported_durations: unknown;
  default_size?: string;

  task_types?: unknown;
}

export const VIDEO_MODES = [
  "text2video",
  "omni",
  "image_reference",
  "first_frame",
  "first_last_frame",
  "edit",
  "extend",
] as const;

export type VideoMode = (typeof VIDEO_MODES)[number];

export const EDIT_MODE_VIDEO_REFERENCE_MAX = 1;

const LEGACY_VIDEO_MODE: Record<string, VideoMode> = {
  default: "text2video",
  prolong: "extend",
};

export function isVideoMode(raw: unknown): raw is VideoMode {
  return typeof raw === "string" && (VIDEO_MODES as readonly string[]).includes(raw);
}

export function normalizeVideoMode(raw: unknown): VideoMode | null {
  if (typeof raw !== "string") return null;
  if (isVideoMode(raw)) return raw;
  return LEGACY_VIDEO_MODE[raw] ?? null;
}










export const EDIT_INTENT_KEYWORDS = [
  "编辑视频",
  "增加",
  "加上",
  "删除",
  "去掉",
  "修改",
  "替换",
  "改成",
] as const;







export const PROLONG_INTENT_KEYWORDS = ["向前延长", "向后延长", "延续", "续写"] as const;








export const NEGATION_KEYWORDS = ["禁止", "不得", "不要", "不能", "勿", "无需"] as const;


const CLAUSE_SEPARATORS = /[，。；！？、,.;!?]/;




function hasIntentKeyword(prompt: string, words: readonly string[]): boolean {
  return prompt.split(CLAUSE_SEPARATORS).some(
    (clause) =>
      !NEGATION_KEYWORDS.some((n) => clause.includes(n)) && words.some((w) => clause.includes(w)),
  );
}

export function resolveVideoMode(
  references: ReadonlyArray<{ role: string; type: string }>,
  prompt: string,
): VideoMode {
  const hasFirst = references.some((r) => r.role === "first_frame");
  const hasLast = references.some((r) => r.role === "last_frame");
  if (hasFirst && hasLast) return "first_last_frame";
  if (hasFirst || hasLast) return "first_frame";
  const ordinary = references.filter((r) => r.role === "reference");
  const videoRefCount = ordinary.filter((r) => r.type === "video").length;
  if (videoRefCount > 0) {
    if (videoRefCount > EDIT_MODE_VIDEO_REFERENCE_MAX) return "omni";
    if (hasIntentKeyword(prompt, PROLONG_INTENT_KEYWORDS)) return "extend";
    if (hasIntentKeyword(prompt, EDIT_INTENT_KEYWORDS)) return "edit";
    return "omni";
  }
  if (ordinary.some((r) => r.type === "audio")) return "omni";
  if (ordinary.some((r) => r.type === "image")) return "image_reference";
  return "text2video";
}






export const TASK_TYPE_PARAM_CONSTRAINT_MESSAGE =
  ERROR_CODES[errorCodeToNumeric(ERROR_TASK_TYPE_PARAM_CONSTRAINT)]!;

export const FROZEN_VIDEO_MODE_KEY = "video_mode";

export const LEGACY_FROZEN_VIDEO_MODE_KEY = "video_task_type";

export function frozenVideoModeOf(input: unknown): VideoMode {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "text2video";
  const row = input as Record<string, unknown>;
  const raw = row[FROZEN_VIDEO_MODE_KEY] ?? row[LEGACY_FROZEN_VIDEO_MODE_KEY];
  return normalizeVideoMode(raw) ?? "text2video";
}

function readStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

function readNumberArray(v: unknown): number[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (v as number[])
    : null;
}







export function modeAllowedRatios(
  taskTypes: unknown,
  mode: VideoMode | undefined,
): string[] | null {
  return readStringArray(modeConstraint(taskTypes, mode)?.allowed_ratios);
}
















const SPEC_KEY_AXES = ["resolution", "aspect_ratio"] as const;


const PIXELS_RE = /^([1-9][0-9]*)x([1-9][0-9]*)$/;






export function parseSpecKey(key: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of key.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const axis = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (value.length === 0) return null;
    if (!(SPEC_KEY_AXES as readonly string[]).includes(axis)) return null;
    if (out[axis] !== undefined) return null;
    out[axis] = value;
  }

  return SPEC_KEY_AXES.every((a) => out[a] !== undefined) ? out : null;
}


export function specKeyOf(resolution: string, aspectRatio: string): string {
  return `resolution=${resolution}|aspect_ratio=${aspectRatio}`;
}









export function normalizeSpecKey(raw: string): string {
  const parts: Array<[string, string]> = [];
  for (const pair of raw.split("|")) {
    const at = pair.indexOf("=");
    if (at <= 0) return raw.trim().toLowerCase();
    parts.push([pair.slice(0, at).trim().toLowerCase(), pair.slice(at + 1).trim().toLowerCase()]);
  }
  parts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return parts.map(([k, v]) => `${k}=${v}`).join("|");
}


export function parsePixels(value: string): { width: number; height: number } | null {
  const m = PIXELS_RE.exec(value);
  return m === null ? null : { width: Number(m[1]), height: Number(m[2]) };
}






export function resolveOutputPixels(
  dimensions: unknown,
  resolution: string,
  aspectRatio: string,
): { width: number; height: number } | null {
  if (typeof dimensions !== "object" || dimensions === null || Array.isArray(dimensions)) {
    return null;
  }


  const map = dimensions as Record<string, unknown>;
  const exact = map[specKeyOf(resolution, aspectRatio)];
  if (typeof exact === "string") return parsePixels(exact);

  const target = normalizeSpecKey(specKeyOf(resolution, aspectRatio));
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== "string") continue;
    if (normalizeSpecKey(key) === target) return parsePixels(value);
  }
  return null;
}



function modeConstraint(
  taskTypes: unknown,
  mode: VideoMode | undefined,
): Record<string, unknown> | null {
  if (!mode) return null;
  const map = taskTypes;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const entry = (map as Record<string, unknown>)[mode];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : null;
}





export function hasModeConstraint(
  taskTypes: unknown,
  mode: VideoMode,
): boolean {
  return modeConstraint(taskTypes, mode) !== null;
}


export interface GenerationParamCheckInput {

  size: string;
  aspect_ratio: string;

  duration?: number;
  mode?: VideoMode;
}


export interface CapabilityParamFailure {
  reason: string;

  field: "size" | "aspect_ratio" | "duration";

  code: string;
}


function matchesSize(
  size: string,
  supported: CapabilityLimitInput["supported_sizes"],
): boolean {
  return supported.some((s) => s.id === size || s.api_value === size);
}


function durationInRange(
  duration: number,
  supported: CapabilityLimitInput["supported_durations"],
): boolean {
  if (Array.isArray(supported)) {
    return supported.includes(duration);
  }
  const range = supported as { min?: number; max?: number; step?: number } | null;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") {

    return true;
  }
  if (duration < range.min || duration > range.max) return false;
  if (range.step === undefined) return true;
  const steps = (duration - range.min) / range.step;
  const nearest = range.min + Math.round(steps) * range.step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(duration), Math.abs(nearest)) * 4;
  return Number.isFinite(nearest) && Math.abs(duration - nearest) <= tolerance;
}

export function aspectRatioIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item) out.push(item);
      continue;
    }
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string" && id) out.push(id);
    }
  }
  return out;
}

function ratios(capability: CapabilityLimitInput): string[] {
  return aspectRatioIds(capability.supported_aspect_ratios);
}





export function checkGenerationParamLimit(
  capability: CapabilityLimitInput,
  params: GenerationParamCheckInput,
): CapabilityParamFailure | null {
  const supportedSizes = Array.isArray(capability.supported_sizes)
    ? capability.supported_sizes
    : [];


  if (
    params.size !== "" &&
    supportedSizes.length > 0 &&
    !matchesSize(params.size, supportedSizes)
  ) {
    const available = supportedSizes
      .map((s) => s.api_value || s.id)
      .filter(Boolean)
      .join(" / ");
    return {
      field: "size",
      code: ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION,
      reason: `当前模型不支持 分辨率/尺寸 ${params.size}，可用：${available}`,
    };
  }
  const constraint = modeConstraint(capability.task_types, params.mode);
  const taskRatios = readStringArray(constraint?.allowed_ratios);
  const taskDurations = readNumberArray(constraint?.allowed_durations);
  const taskLabel = params.mode ? `当前模式（${params.mode}）` : "当前模式";

  const ratioList = taskRatios ?? ratios(capability);
  if (ratioList.length > 0 && !ratioList.includes(params.aspect_ratio)) {



    if (params.mode === "edit" || params.mode === "extend") {
      return {
        field: "aspect_ratio",
        code: ERROR_TASK_TYPE_PARAM_CONSTRAINT,
        reason: TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
      };
    }
    return {
      field: "aspect_ratio",
      code: ERROR_CAPABILITY_UNSUPPORTED_RATIO,
      reason: `${taskRatios ? taskLabel : "当前模型"}不支持 比例 ${params.aspect_ratio}，可用：${ratioList.join(" / ")}`,
    };
  }
  if (params.duration !== undefined) {
    const d = Number(params.duration);
    if (taskDurations) {

      if (!taskDurations.includes(d)) {
        return {
          field: "duration",
          code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
          reason: `${taskLabel}不支持 时长 ${d} 秒，可用：${taskDurations.join(" / ")}`,
        };
      }
    } else if (!(d === -1 && constraint?.allow_auto_duration === true)) {

      if (!Number.isFinite(d) || d <= 0) {
        return { field: "duration", code: ERROR_CAPABILITY_UNSUPPORTED_DURATION, reason: "时长必须为正数" };
      }
      const durations = capability.supported_durations;
      if (durations !== undefined && durations !== null && !durationInRange(d, durations)) {
        if (Array.isArray(durations)) {
          return {
            field: "duration",
            code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
            reason: `当前模型不支持 时长 ${d} 秒，可用档位：${durations.join(" / ")}`,
          };
        }
        const range = durations as { min?: number; max?: number } | null;
        if (range && typeof range.min === "number" && typeof range.max === "number") {
          return {
            field: "duration",
            code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
            reason: `当前模型不支持 时长 ${d} 秒，可用范围 ${range.min}-${range.max} 秒`,
          };
        }
      }
    }
  }
  return null;
}


export function toGenerationParamCheckInput(input: {
  resolution?: unknown;
  size?: unknown;
  aspect_ratio?: unknown;
  duration?: unknown;
}): GenerationParamCheckInput | null {
  if (typeof input.aspect_ratio !== "string" || input.aspect_ratio.length === 0) {
    return null;
  }
  const size =
    typeof input.resolution === "string" && input.resolution.length > 0
      ? input.resolution
      : typeof input.size === "string" && input.size.length > 0
        ? input.size
        : "";


  const duration =
    input.duration === undefined || input.duration === null
      ? undefined
      : Number(input.duration);
  if (size.length === 0 && duration === undefined) return null;
  return { size, aspect_ratio: input.aspect_ratio, ...(duration !== undefined ? { duration } : {}) };
}
