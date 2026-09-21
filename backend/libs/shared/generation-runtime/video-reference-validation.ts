import {
  ERROR_INVALID_REFERENCE_MEDIA,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_UNSUPPORTED_INPUT,
} from "@lib/contracts";
import type { MaterialReference } from "./material-reference.js";
import { VideoInputError } from "./material-reference.js";
import type { VideoWorkerInputAsset, VideoReference } from "./video-job-types.js";

// 平台物理约束——**不是模型知识，能力行里没有对应字段**（运营改不了，也不会为它们新增配置列）：
// 单视频字节 / 单边像素 / 总像素 / 宽高比 / 单视频最短时长 / mime 白名单。
//
// DEFAULT_* 语义：**无配置可读时的缺省**，不是「配置的兜底」——没有配置字段，所以无条件生效，
// 这是设计如此（命名沿用 model-capability-repo 的 DEFAULT_IMAGE_REFERENCE_MAX 家族）。
// 命名与 Java 镜像常量（worker-java VideoJobProcessor 同名 DEFAULT_*）保持一致。
const DEFAULT_MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const DEFAULT_MIN_REFERENCE_VIDEO_SECONDS = 2;
const DEFAULT_MIN_REFERENCE_VIDEO_SIDE = 300;
const DEFAULT_MAX_REFERENCE_VIDEO_SIDE = 6000;
const DEFAULT_MIN_REFERENCE_VIDEO_PIXELS = 409_600;
const DEFAULT_MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
const DEFAULT_MIN_REFERENCE_VIDEO_RATIO = 0.4;
const DEFAULT_MAX_REFERENCE_VIDEO_RATIO = 2.5;
const DEFAULT_REFERENCE_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);

/** 参考素材上限——**全部来自模型能力行 features**（ADR-0086），程序里不写死任何一条。
 *  字段名与 ModelFeatures 同名，调用方可直接传 `model.features`（结构类型）。
 *  「哪个模型支持参考视频/音频」= video_reference / audio_reference 位，
 *  与接纳侧 checkReferenceLimits（handle-create-generation-job）同源同解。 */
export interface ReferenceLimits {
  image_reference_max: number;
  video_reference: boolean;
  video_reference_max: number;
  audio_reference: boolean;
  audio_reference_max: number;
  /** 参考素材已知总时长上限（秒）；null = 能力行未配 → 不限。 */
  max_reference_duration_sec: number | null;
}

/** IKHBDO：冻结进 job.input.reference_limits 的形态（Java worker 只读这份快照，
 *  不含任何模型知识）。字段名 snake_case，与能力行 features 同名，Java 侧一一对应。
 *  支持位（video_reference / audio_reference）**不入快照**：接纳侧已是唯一闸门，
 *  worker 再判一遍只会多一份会漂移的副本（见 worker 侧同处注释）。
 *  字段可缺省——缺省 = 该字段未配（能力行未归一化/未配置），worker 侧按迁移兜底处理。 */
export interface FrozenReferenceLimits {
  image_reference_max?: number;
  video_reference_max?: number;
  audio_reference_max?: number;
  max_reference_duration_sec?: number | null;
}

/** 能力行 features → 冻结快照。接纳侧建任务时调用（对齐 generate_audio 的冻结口径）。
 *  只拷贝能读到的字段：读不到的宁可不写，也不写 undefined（worker 侧按缺省兜底）。 */
export function freezeReferenceLimits(
  limits: Partial<ReferenceLimits>,
): FrozenReferenceLimits {
  const frozen: FrozenReferenceLimits = {};
  if (typeof limits.image_reference_max === "number") {
    frozen.image_reference_max = limits.image_reference_max;
  }
  if (typeof limits.video_reference_max === "number") {
    frozen.video_reference_max = limits.video_reference_max;
  }
  if (typeof limits.audio_reference_max === "number") {
    frozen.audio_reference_max = limits.audio_reference_max;
  }
  if (
    typeof limits.max_reference_duration_sec === "number" ||
    limits.max_reference_duration_sec === null
  ) {
    frozen.max_reference_duration_sec = limits.max_reference_duration_sec;
  }
  return frozen;
}

function validateReferences(
  limits: ReferenceLimits,
  assets: VideoWorkerInputAsset[],
  materials: MaterialReference[],
): VideoReference[] {
  let imageCount = 0;
  let videoCount = 0;
  let audioCount = 0;
  let knownVideoDuration = 0;
  const references = assets.map<VideoReference>((asset) => {
    if (asset.type === "image") {
      imageCount += 1;
      return { type: "image", url: asset.url };
    }
    if (asset.type === "audio") {
      // IKDJNZ：参考音频——本地音频素材作为 audio reference 支持（不占图/视频额度）。
      audioCount += 1;
      return { type: "audio", url: asset.url };
    }
    if (asset.type !== "video") {
      throw new VideoInputError(
        ERROR_UNSUPPORTED_INPUT,
        "视频生成只支持图片、视频或音频参考素材",
      );
    }
    videoCount += 1;
    validateReferenceVideo(asset, limits.max_reference_duration_sec);
    if (asset.duration !== null && asset.duration !== undefined) {
      knownVideoDuration += asset.duration;
    }
    return { type: "video", url: asset.url };
  });

  // 素材库引用：并入图/视频/音频数量并集与能力行上限；
  // 时长/大小/分辨率等物理校验只作用于本地 Asset（素材库素材由上游强校验）。
  for (const material of materials) {
    if (material.type === "image") {
      imageCount += 1;
    } else if (material.type === "video") {
      videoCount += 1;
    } else {
      audioCount += 1;
    }
    references.push({ type: material.type, url: `asset://${material.id}` });
  }

  // 上限与支持位全读能力行（ADR-0086 / IKHBDO）：文案与判定顺序对齐接纳侧 checkReferenceLimits。
  if (imageCount > limits.image_reference_max) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      `参考图最多 ${limits.image_reference_max} 张`,
    );
  }
  if (videoCount > 0 && !limits.video_reference) {
    throw new VideoInputError(ERROR_UNSUPPORTED_INPUT, "当前模型不支持视频素材参考");
  }
  if (audioCount > 0 && !limits.audio_reference) {
    throw new VideoInputError(ERROR_UNSUPPORTED_INPUT, "当前模型不支持音频素材参考");
  }
  if (videoCount > limits.video_reference_max) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      `参考视频最多 ${limits.video_reference_max} 个`,
    );
  }
  if (audioCount > limits.audio_reference_max) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      `参考音频最多 ${limits.audio_reference_max} 个`,
    );
  }
  if (
    limits.max_reference_duration_sec !== null &&
    knownVideoDuration > limits.max_reference_duration_sec
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      `参考视频已知总时长不能超过 ${limits.max_reference_duration_sec} 秒`,
    );
  }
  return references;
}

/** @param maxDurationSec 能力行 max_reference_duration_sec；null = 未配 → 单视频不设上限。 */
function validateReferenceVideo(
  asset: VideoWorkerInputAsset,
  maxDurationSec: number | null,
): void {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime && !DEFAULT_REFERENCE_VIDEO_MIMES.has(mime)) {
    throw new VideoInputError(ERROR_INVALID_REFERENCE_MEDIA, "参考视频只支持 MP4 或 MOV");
  }
  if (
    asset.size !== null &&
    asset.size !== undefined &&
    (!Number.isFinite(asset.size) ||
      asset.size <= 0 ||
      asset.size > DEFAULT_MAX_REFERENCE_VIDEO_BYTES)
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "单个参考视频不能超过 200 MB",
    );
  }
  if (
    asset.duration !== null &&
    asset.duration !== undefined &&
    (!Number.isFinite(asset.duration) ||
      asset.duration < DEFAULT_MIN_REFERENCE_VIDEO_SECONDS ||
      (maxDurationSec !== null && asset.duration > maxDurationSec))
  ) {
    // 最短 2 秒是素材平台约束（能力行无字段）；上限读能力行。
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      maxDurationSec === null
        ? `单个参考视频时长不能少于 ${DEFAULT_MIN_REFERENCE_VIDEO_SECONDS} 秒`
        : `单个参考视频时长必须为 ${DEFAULT_MIN_REFERENCE_VIDEO_SECONDS} 至 ${maxDurationSec} 秒`,
    );
  }
  validateReferenceVideoDimensions(asset);
}

function validateReferenceVideoDimensions(asset: VideoWorkerInputAsset): void {
  const width = asset.width;
  const height = asset.height;
  const knownSides = [width, height].filter(
    (side): side is number => side !== null && side !== undefined,
  );
  if (
    knownSides.some(
      (side) =>
        !Number.isInteger(side) ||
        side < DEFAULT_MIN_REFERENCE_VIDEO_SIDE ||
        side > DEFAULT_MAX_REFERENCE_VIDEO_SIDE,
    )
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "参考视频单边像素必须为 300 至 6000",
    );
  }
  if (width === null || width === undefined || height === null || height === undefined) {
    return;
  }
  const pixels = width * height;
  const ratio = width / height;
  if (
    pixels < DEFAULT_MIN_REFERENCE_VIDEO_PIXELS ||
    pixels > DEFAULT_MAX_REFERENCE_VIDEO_PIXELS ||
    ratio < DEFAULT_MIN_REFERENCE_VIDEO_RATIO ||
    ratio > DEFAULT_MAX_REFERENCE_VIDEO_RATIO
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "参考视频宽高比或总像素不满足要求",
    );
  }
}

export { validateReferenceVideo, validateReferenceVideoDimensions, validateReferences };
