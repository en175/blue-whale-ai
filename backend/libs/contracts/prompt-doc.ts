

export interface VideoRefItem {
  id: string;
  role: "first_frame" | "last_frame" | "reference";
  type: "image" | "video" | "audio";
}

const VIDEO_TYPE_LABELS: Record<VideoRefItem["type"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

export function videoRefLabel(
  refId: string,
  refs: readonly VideoRefItem[],
): string | null {
  const typeCounters = new Map<VideoRefItem["type"], number>();
  for (const ref of refs) {
    if (ref.role === "first_frame") {
      if (ref.id === refId) return "首帧";
      continue;
    }
    if (ref.role === "last_frame") {
      if (ref.id === refId) return "尾帧";
      continue;
    }
    const next = (typeCounters.get(ref.type) ?? 0) + 1;
    typeCounters.set(ref.type, next);
    if (ref.id === refId) return `${VIDEO_TYPE_LABELS[ref.type]}${next}`;
  }
  return null;
}

export function buildReferenceMarkerLabels(
  refs: readonly VideoRefItem[],
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const ref of refs) {
    const label = videoRefLabel(ref.id, refs);
    if (label !== null) labels.set(ref.id, label);
  }
  return labels;
}
