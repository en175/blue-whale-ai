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
}

/** 提交侧待校验参数（Dock 视频/图片扁平字段，归一化由调用方完成）。 */
export interface GenerationParamCheckInput {
  /** 视频分辨率档（如 1080p）或图片尺寸档（如 2k）——与能力行 supported_sizes 的 id/api_value 比对。 */
  size: string;
  aspect_ratio: string;
  /** 视频时长（秒）。图片/音频不校验。 */
  duration?: number;
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
  const ratioList = ratios(capability);
  if (ratioList.length > 0 && !ratioList.includes(params.aspect_ratio)) {
    return {
      field: "aspect_ratio",
      code: ERROR_CAPABILITY_UNSUPPORTED_RATIO,
      reason: `当前模型不支持 比例 ${params.aspect_ratio}，可用：${ratioList.join(" / ")}`,
    };
  }
  if (params.duration !== undefined) {
    const d = Number(params.duration);
    // ADR-0086：duration=-1 是上游哨兵值 = 模型自动选时长（仅 edit 任务合法，由 task_types 覆盖层校验）；
    // 基础能力范围（4-30）不认 -1，-1 只在任务类型约束层放行，此处保持严格正数 + 范围。
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
