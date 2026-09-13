import {
  ERROR_INVALID_REFERENCE_MEDIA,
  ERROR_REFERENCE_LIMIT_EXCEEDED,
  ERROR_UNSUPPORTED_INPUT,
} from "@lib/contracts";
import type { MaterialReference } from "./material-reference.js";
import { VideoInputError } from "./material-reference.js";
import type { VideoWorkerInputAsset, VideoReference } from "./video-job-types.js";

const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_VIDEOS = 3;
const MAX_REFERENCE_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_REFERENCE_VIDEO_SECONDS = 15;
const MIN_REFERENCE_VIDEO_SIDE = 300;
const MAX_REFERENCE_VIDEO_SIDE = 6000;
const MIN_REFERENCE_VIDEO_PIXELS = 409_600;
const MAX_REFERENCE_VIDEO_PIXELS = 8_295_044;
const MIN_REFERENCE_VIDEO_RATIO = 0.4;
const MAX_REFERENCE_VIDEO_RATIO = 2.5;
const REFERENCE_VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);

function validateReferences(
  model: string,
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
    validateReferenceVideo(asset);
    if (asset.duration !== null && asset.duration !== undefined) {
      knownVideoDuration += asset.duration;
    }
    return { type: "video", url: asset.url };
  });

  // 素材库引用：并入图/视频/音频数量并集与 Seedance 2.0 约束；
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

  if (imageCount > MAX_REFERENCE_IMAGES || videoCount > MAX_REFERENCE_VIDEOS) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      "Seedance 2.0 最多支持 9 张参考图片和 3 个参考视频",
    );
  }
  // IKDJNZ：参考音频数上限沿用参考视频同档（3）；参考音频仅 Seedance 2.0 支持（同参考视频）。
  if (audioCount > MAX_REFERENCE_VIDEOS) {
    throw new VideoInputError(
      ERROR_REFERENCE_LIMIT_EXCEEDED,
      "Seedance 2.0 最多支持 3 个参考音频",
    );
  }
  if ((videoCount > 0 || audioCount > 0) && !isSeedance2Model(model)) {
    throw new VideoInputError(
      ERROR_UNSUPPORTED_INPUT,
      "只有 Seedance 2.0 支持参考视频和参考音频",
    );
  }
  if (knownVideoDuration > MAX_REFERENCE_VIDEO_SECONDS) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "参考视频已知总时长不能超过 15 秒",
    );
  }
  return references;
}

function validateReferenceVideo(asset: VideoWorkerInputAsset): void {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime && !REFERENCE_VIDEO_MIMES.has(mime)) {
    throw new VideoInputError(ERROR_INVALID_REFERENCE_MEDIA, "参考视频只支持 MP4 或 MOV");
  }
  if (
    asset.size !== null &&
    asset.size !== undefined &&
    (!Number.isFinite(asset.size) ||
      asset.size <= 0 ||
      asset.size > MAX_REFERENCE_VIDEO_BYTES)
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
      asset.duration < 2 ||
      asset.duration > MAX_REFERENCE_VIDEO_SECONDS)
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "单个参考视频时长必须为 2 至 15 秒",
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
        side < MIN_REFERENCE_VIDEO_SIDE ||
        side > MAX_REFERENCE_VIDEO_SIDE,
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
    pixels < MIN_REFERENCE_VIDEO_PIXELS ||
    pixels > MAX_REFERENCE_VIDEO_PIXELS ||
    ratio < MIN_REFERENCE_VIDEO_RATIO ||
    ratio > MAX_REFERENCE_VIDEO_RATIO
  ) {
    throw new VideoInputError(
      ERROR_INVALID_REFERENCE_MEDIA,
      "参考视频宽高比或总像素不满足 Seedance 2.0 要求",
    );
  }
}

function isSeedance2Model(model: string): boolean {
  return model === "seedance-2" || /^doubao-seedance-2-0(?:-|$)/.test(model);
}

export {
  isSeedance2Model,
  validateReferenceVideo,
  validateReferenceVideoDimensions,
  validateReferences,
};
