// IKE7JP：生成参数对模型能力目录的结构性校验（纯函数，无 IO）。
// 提交侧（Dock 视频/图片）在接纳当下校验 resolution/size/aspect_ratio/duration 是否
// 落在能力目录支持范围，失败直接 4xx 返回带可用值的可修复文案，不再拖到 worker 执行期。
//
// 与 SceneCard 路径的 checkCapabilityLimit（scene-card-generation-repo.ts）语义一致：
// 那里的入参是 frozenGenerationParametersSchema（size + aspect_ratio + duration 档位 id），
// 这里把 Dock 的扁平字段（resolution + aspect_ratio + duration）归一化后同源校验。
// 后续可把 checkCapabilityLimit 迁到本文件共享（IKE7JP 下一步）。

import { ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION, ERROR_CAPABILITY_UNSUPPORTED_RATIO, ERROR_CAPABILITY_UNSUPPORTED_DURATION } from "./error-codes.js";

/** 提交侧能力目录行（handleCreateGenerationJob 已从 listEnabledByType 取回）。 */
export interface CapabilityLimitInput {
  supported_sizes: Array<{ id?: string; api_value?: string }>;
  supported_aspect_ratios: unknown;
  supported_durations: unknown;
  default_size?: string;
  /** IKFPYX：按任务类型的比例/时长约束（features.task_types）。命中时覆盖基础比例/时长校验。 */
  task_types?: unknown;
}

/** IKFPYX：视频任务类型（官方口径，由输入素材角色 + 提示词意图判定）。
 *  与火山方舟 Seedance 2.5 使用必读一致：首帧/首尾帧按 references 角色；编辑/延长需参考视频 + 提示词意图。 */
export type VideoTaskType = "default" | "first_frame" | "first_last_frame" | "edit" | "prolong";

/** 编辑意图关键词（官方：「编辑视频、增加/加上、删除/去掉、修改/替换/改成」）。 */
const EDIT_INTENT_KEYWORDS = [
  "编辑视频",
  "编辑",
  "增加",
  "加上",
  "删除",
  "去掉",
  "修改",
  "替换",
  "改成",
] as const;

/** 延长意图关键词（官方：「向前/向后延长、延续、续写」）。 */
const PROLONG_INTENT_KEYWORDS = ["延长", "延续", "续写", "向前", "向后"] as const;

/** IKFPYX：判定视频任务类型（纯函数，无 IO；backend 与 worker-java 同源口径）。
 *  优先级：首尾帧角色 > 单帧角色 > 参考视频 + 提示词意图（延长先于编辑，后者词面更宽）> default。 */
export function resolveVideoTaskType(
  references: ReadonlyArray<{ role: string; type: string }>,
  prompt: string,
): VideoTaskType {
  const hasFirst = references.some((r) => r.role === "first_frame");
  const hasLast = references.some((r) => r.role === "last_frame");
  if (hasFirst && hasLast) return "first_last_frame";
  if (hasFirst || hasLast) return "first_frame";
  const hasVideoRef = references.some((r) => r.role === "reference" && r.type === "video");
  if (!hasVideoRef) return "default";
  if (PROLONG_INTENT_KEYWORDS.some((w) => prompt.includes(w))) return "prolong";
  if (EDIT_INTENT_KEYWORDS.some((w) => prompt.includes(w))) return "edit";
  return "default";
}

function readStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
}

function readNumberArray(v: unknown): number[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (v as number[])
    : null;
}

/** 取该任务类型的约束（未传任务类型/无该类型配置/非法形态 → null = 回落基础能力校验）。
 *  注：`default` 也照常取用——配了 default 约束就应按它校验（否则该配置形同虚设）。 */
function taskTypeConstraint(
  capability: CapabilityLimitInput,
  taskType: VideoTaskType | undefined,
): Record<string, unknown> | null {
  if (!taskType) return null;
  const map = capability.task_types;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const entry = (map as Record<string, unknown>)[taskType];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : null;
}

/** 提交侧待校验参数（Dock 视频/图片扁平字段，归一化由调用方完成）。 */
export interface GenerationParamCheckInput {
  /** 视频分辨率档（如 1080p）或图片尺寸档（如 2k）——与能力行 supported_sizes 的 id/api_value 比对。 */
  size: string;
  aspect_ratio: string;
  /** 视频时长（秒）。图片/音频不校验。 */
  duration?: number;
  /** IKFPYX：视频任务类型（命中 features.task_types 时按该类型的比例/时长约束校验）。 */
  task_type?: VideoTaskType;
}

/** 校验失败原因：带可用值提示，前端可直接展示。 */
export interface CapabilityParamFailure {
  reason: string;
  /** 供日志/调试；对外 message 用 reason。 */
  field: "size" | "aspect_ratio" | "duration";
  /** IKE7JP：细分错误码（resolution/ratio/duration 各一，出自码表）。 */
  code: string;
}

/** 尺寸档命中：按 id 或 api_value 比对能力行 supported_sizes 元素。 */
function matchesSize(
  size: string,
  supported: CapabilityLimitInput["supported_sizes"],
): boolean {
  return supported.some((s) => s.id === size || s.api_value === size);
}

/** 时长档：DB 支持两种形态（档位数组 [3,5,10] 或 {min,max,step} 范围对象）。 */
function durationInRange(
  duration: number,
  supported: CapabilityLimitInput["supported_durations"],
): boolean {
  if (Array.isArray(supported)) {
    return supported.includes(duration);
  }
  const range = supported as { min?: number; max?: number } | null;
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") {
    // 无有效范围定义：不阻断（能力行未配置时长约束时放行，worker 兜底）。
    return true;
  }
  return duration >= range.min && duration <= range.max;
}

function ratios(capability: CapabilityLimitInput): string[] {
  return Array.isArray(capability.supported_aspect_ratios)
    ? capability.supported_aspect_ratios
    : [];
}

/** 校验提交参数是否落在能力目录支持范围。
 *  IKFPYX：命中 features.task_types[task_type] 时，该类型的 allowed_ratios / allowed_durations
 *  覆盖基础比例/时长校验（支持 duration=-1 自动时长）；未命中回落基础能力行。
 *  @returns 失败原因（带可用值提示）；全部通过返回 null。 */
export function checkGenerationParamLimit(
  capability: CapabilityLimitInput,
  params: GenerationParamCheckInput,
): CapabilityParamFailure | null {
  const supportedSizes = Array.isArray(capability.supported_sizes)
    ? capability.supported_sizes
    : [];
  // IKE7JP review：size 为空串（只带 duration 的视频任务）时不按分辨率拦截——
  // 分辨率未指定时由能力默认值兜底，仅校验明确携带的 duration。
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
  // IKFPYX：任务类型约束优先（首帧/首尾帧/edit/prolong 各自的比例与时长口径）。
  const constraint = taskTypeConstraint(capability, params.task_type);
  const taskRatios = readStringArray(constraint?.allowed_ratios);
  const taskDurations = readNumberArray(constraint?.allowed_durations);
  const taskLabel = params.task_type ? `当前任务类型（${params.task_type}）` : "当前任务类型";

  const ratioList = taskRatios ?? ratios(capability);
  if (ratioList.length > 0 && !ratioList.includes(params.aspect_ratio)) {
    return {
      field: "aspect_ratio",
      code: ERROR_CAPABILITY_UNSUPPORTED_RATIO,
      reason: `${taskRatios ? taskLabel : "当前模型"}不支持 比例 ${params.aspect_ratio}，可用：${ratioList.join(" / ")}`,
    };
  }
  if (params.duration !== undefined) {
    const d = Number(params.duration);
    if (taskDurations) {
      // 任务类型约束显式给出可用时长（可含 -1 自动时长）——严格按该清单校验。
      if (!taskDurations.includes(d)) {
        return {
          field: "duration",
          code: ERROR_CAPABILITY_UNSUPPORTED_DURATION,
          reason: `${taskLabel}不支持 时长 ${d} 秒，可用：${taskDurations.join(" / ")}`,
        };
      }
    } else {
      // 基础能力行：仅正数，且在 supported_durations 范围内（不含 -1）。
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

/** 把 Dock 视频参数解析成校验输入；resolution 缺省回退 size（plan/scene_card 兼容）。 */
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
  // IKE7JP review：duration 单独存在（视频只带时长、无 resolution/size）也进入校验——
  // 不能让只带时长越界一路漏到 worker。size 为空串时 duration 仍有效。
  const duration =
    input.duration === undefined || input.duration === null
      ? undefined
      : Number(input.duration);
  if (size.length === 0 && duration === undefined) return null;
  return { size, aspect_ratio: input.aspect_ratio, ...(duration !== undefined ? { duration } : {}) };
}
