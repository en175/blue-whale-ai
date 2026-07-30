import type { Asset } from "./model";

export type AssetInfoRow = {
  label: "类型" | "尺寸" | "时长" | "格式";
  value: string;
};

const KIND_LABELS: Record<"image" | "video" | "audio", string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const MIME_FORMATS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/svg+xml": "SVG",
  "video/quicktime": "MOV",
  "audio/mpeg": "MP3",
  "audio/mp4": "M4A",
};

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatDimensions(asset: Asset): string {
  if (asset.kind === "audio") return "不适用";
  if (!isPositiveNumber(asset.width) || !isPositiveNumber(asset.height)) {
    return "未知";
  }
  return `${Math.round(asset.width)} × ${Math.round(asset.height)}`;
}

function formatDuration(duration: number | undefined): string {
  if (!isPositiveNumber(duration)) return "未知";
  const totalSeconds = Math.floor(duration);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteText =
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${minuteText}:${String(seconds).padStart(2, "0")}`;
}

function formatMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return "未知";
  if (MIME_FORMATS[normalized]) return MIME_FORMATS[normalized];
  const subtype = normalized.split("/")[1];
  if (!subtype) return "未知";
  return subtype.replace(/^x-/, "").replace(/\+.*$/, "").toUpperCase();
}

export function buildAssetInfoRows(asset: Asset): AssetInfoRow[] {
  if (
    asset.kind !== "image" &&
    asset.kind !== "video" &&
    asset.kind !== "audio"
  ) {
    return [];
  }

  const rows: AssetInfoRow[] = [
    { label: "类型", value: KIND_LABELS[asset.kind] },
    { label: "尺寸", value: formatDimensions(asset) },
  ];
  if (asset.kind === "video" || asset.kind === "audio") {
    rows.push({ label: "时长", value: formatDuration(asset.duration) });
  }
  rows.push({ label: "格式", value: formatMimeType(asset.mimeType) });
  return rows;
}
