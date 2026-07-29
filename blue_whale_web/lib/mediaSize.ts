/**
 * mediaSize —— 上传媒体真实尺寸读取 + 短边缩放
 *
 * 生成路径有 aspectRatio token（走 `parseAspectRatio`），上传路径无 token，
 * 故读媒体真实像素（图片 `naturalWidth/Height`、视频 `videoWidth/Height`）等比缩放到
 * 短边 200（与 ASPECT_RATIO_BASE 一致）。失败/超时回退默认比例（图 1:1 / 视频 16:9），
 * 不阻塞落节点。
 */

export type MediaKind = "image" | "video" | "audio";
export type PixelSize = { width: number; height: number };

/** 短边基准边长（与 `ASPECT_RATIO_BASE` 一致）。 */
export const MEDIA_SHORT_SIDE = 200;

/** 元数据读取超时：超过即回退，避免阻塞节点落地。 */
const READ_TIMEOUT_MS = 3000;

/** 读不上来时的默认回退比例（图 1:1 / 视频 16:9 / 音频卡片）。 */
export function fallbackMediaSize(kind: MediaKind): PixelSize {
  if (kind === "audio") return { width: 240, height: 120 }; // 音频无像素维度，用固定卡片
  return kind === "image"
    ? { width: MEDIA_SHORT_SIDE, height: MEDIA_SHORT_SIDE }
    : { width: 356, height: MEDIA_SHORT_SIDE }; // 16:9 短边 200
}

/** 上传文件 MIME → 媒体 kind（无/未知 MIME 回退 image）。 */
export function detectMediaKind(file: File): MediaKind {
  const t = file.type || "";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  // MIME 缺省时按扩展名兜底（部分浏览器对特殊格式不填 MIME）
  const name = file.name.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(name)) return "video";
  if (/\.(mp3|wav|flac|aac|m4a|ogg|opus)$/.test(name)) return "audio";
  return "image";
}

/**
 * 把任意真实像素尺寸等比缩放到短边 = base。
 * w>=h：高=base、宽=base×(w/h)；否则反之。非法尺寸返回 null（调用方自行回退）。
 */
export function scaleToShortSide(
  w: number,
  h: number,
  base = MEDIA_SHORT_SIDE,
): PixelSize | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;
  if (w >= h) return { width: Math.round((base * w) / h), height: base };
  return { width: base, height: Math.round((base * h) / w) };
}

/**
 * 读取上传媒体真实尺寸，等比缩放到短边 200。
 * 图片用 `new Image()` onload；视频用 `<video>` onloadedmetadata。
 * 超时(~3s) / onerror / 0 尺寸 → 回退默认比例。永不 reject。
 */
export function readMediaNaturalSize(
  url: string,
  kind: MediaKind,
): Promise<PixelSize> {
  // 音频无像素维度，直接回退固定卡片（不创建 <img>/<video>）。
  if (kind === "audio") return Promise.resolve(fallbackMediaSize(kind));
  return new Promise<PixelSize>((resolve) => {
    let done = false;
    const finish = (size: PixelSize) => {
      if (done) return;
      done = true;
      resolve(size);
    };
    const timer = setTimeout(
      () => finish(fallbackMediaSize(kind)),
      READ_TIMEOUT_MS,
    );

    if (kind === "image") {
      const img = new Image();
      img.onload = () => {
        clearTimeout(timer);
        finish(
          scaleToShortSide(img.naturalWidth, img.naturalHeight) ??
            fallbackMediaSize(kind),
        );
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(fallbackMediaSize(kind));
      };
      img.src = url;
    } else {
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.onloadedmetadata = () => {
        clearTimeout(timer);
        finish(
          scaleToShortSide(vid.videoWidth, vid.videoHeight) ??
            fallbackMediaSize(kind),
        );
      };
      vid.onerror = () => {
        clearTimeout(timer);
        finish(fallbackMediaSize(kind));
      };
      vid.src = url;
    }
  });
}
