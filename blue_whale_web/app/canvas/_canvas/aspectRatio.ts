/**
 * aspectRatio —— 比例字符串解析纯函数（从 card.meta 到像素尺寸）
 *
 * 将 card.meta 中的比例 token（"1:1" / "16:9" …）解析成驱动 NodeItem 尺寸的像素规格。
 * 基准边长统一作用于短边，长边按比例放大，使不同比例在画布上视觉权重相等。
 * 与 constants.ts 的 VIDEO_ASPECT_RATIOS token 集保持一致。
 */

/** 基准边长（与 addNode 的 image 默认边长 240 一致） */
export const ASPECT_RATIO_BASE = 240;

export type PixelSize = { width: number; height: number };

const RATIO_RE = /^(\d+):(\d+)$/;

/**
 * 把比例 token 解析成像素尺寸。
 * 基准边长作用于短边：w>=h 时高=240、宽=240×(w/h)；否则反之。
 * 回退（空串 / 非数字 / 缺冒号 / 含 0 避免除零）一律返回 {240, 240}。
 */
export function parseAspectRatio(meta: string): PixelSize {
  const fallback: PixelSize = { width: ASPECT_RATIO_BASE, height: ASPECT_RATIO_BASE };
  if (typeof meta !== "string") return fallback;

  const match = RATIO_RE.exec(meta.trim());
  if (!match) return fallback;

  const w = Number.parseInt(match[1], 10);
  const h = Number.parseInt(match[2], 10);
  if (Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) return fallback;

  if (w >= h) {
    return { width: Math.round((ASPECT_RATIO_BASE * w) / h), height: ASPECT_RATIO_BASE };
  }
  return { width: ASPECT_RATIO_BASE, height: Math.round((ASPECT_RATIO_BASE * h) / w) };
}
