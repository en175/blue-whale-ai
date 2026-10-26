import {
  ERROR_INVALID_REFERENCE_MEDIA,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_UNSUPPORTED_INPUT,
  type VideoMode,
} from "@lib/contracts";
import type { MaterialReference } from "./material-reference.js";
import { VideoInputError } from "./material-reference.js";
import { videoReferenceMax } from "./reference-limits.js";
import type { VideoWorkerInputAsset, VideoReference } from "./video-job-types.js";

const DEFAULT_MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const DEFAULT_MIN_REFERENCE_VIDEO_SECONDS = 2;
const DEFAULT_MIN_REFERENCE_VIDEO_SIDE = 300;
const DEFAULT_MAX_REFERENCE_VIDEO_SIDE = 6000;
const DEFAULT_MIN_REFERENCE_VIDEO_PIXELS = 409_600;
const DEFAULT_MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
const DEFAULT_MIN_REFERENCE_VIDEO_RATIO = 0.4;
const DEFAULT_MAX_REFERENCE_VIDEO_RATIO = 2.5;
const DEFAULT_REFERENCE_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);

export interface ReferenceLimits {
  image_reference_max: number;
  video_reference: boolean;
  video_reference_max: number;
  audio_reference: boolean;
  audio_reference_max: number;
  max_reference_duration_sec: number | null;
}

export interface FrozenReferenceLimits {
  image_reference_max?: number;
  video_reference_max?: number;
  audio_reference_max?: number;
  max_reference_duration_sec?: number | null;
}

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
  mode?: VideoMode | null,
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
  const videoMax = videoReferenceMax(limits.video_reference_max, mode);
  if (videoCount > videoMax) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      `参考视频最多 ${videoMax} 个`,
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
