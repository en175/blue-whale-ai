
export interface ReferenceLimitFeatures {
  video_reference: boolean;
  video_reference_max: number;
  audio_reference: boolean;
  audio_reference_max: number;
  image_reference_max: number;
  max_reference_duration_sec: number | null;
}

export function checkReferenceLimits(
  features: ReferenceLimitFeatures,
  references: Array<{ type: "image" | "video" | "audio"; duration?: number | undefined }>,
  kind: "image" | "video" | "audio",
): string | null {
  if (kind === "image") {
    const imageCount = references.filter((r) => r.type === "image").length;
    if (imageCount > features.image_reference_max)
      return `参考图最多 ${features.image_reference_max} 张`;
    return null;
  }
  if (kind === "audio") {
    const audioCount = references.filter((r) => r.type === "audio").length;
    const imageCount = references.filter((r) => r.type === "image").length;
    if (audioCount > features.audio_reference_max)
      return `参考音频最多 ${features.audio_reference_max} 个`;
    if (imageCount > features.image_reference_max)
      return `参考图最多 ${features.image_reference_max} 个`;
    if (audioCount > 0 && imageCount > 0)
      return "音频与图片参考不可混用";
    if (features.max_reference_duration_sec != null) {
      const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
      if (total > features.max_reference_duration_sec)
        return `参考素材总时长超过 ${features.max_reference_duration_sec} 秒，请减少素材`;
    }
    return null;
  }
  const imageRefs = references.filter((r) => r.type === "image");
  const videoRefs = references.filter((r) => r.type === "video");
  const audioRefs = references.filter((r) => r.type === "audio");
  if (imageRefs.length > features.image_reference_max)
    return `参考图最多 ${features.image_reference_max} 张`;
  if (videoRefs.length > 0 && !features.video_reference)
    return "当前模型不支持视频素材参考";
  if (audioRefs.length > 0 && !features.audio_reference)
    return "当前模型不支持音频素材参考";
  if (videoRefs.length > features.video_reference_max)
    return `参考视频最多 ${features.video_reference_max} 个`;
  if (audioRefs.length > features.audio_reference_max)
    return `参考音频最多 ${features.audio_reference_max} 个`;
  if (features.max_reference_duration_sec != null) {
    const total = references.reduce((sum, r) => sum + (r.duration ?? 0), 0);
    if (total > features.max_reference_duration_sec)
      return `参考素材总时长超过 ${features.max_reference_duration_sec} 秒，请减少素材`;
  }
  return null;
}
