/**
 * Utils —— 画布模块的公共工具方法（工具层）
 * 提供 squircle（超椭圆圆角）SVG 路径生成函数，供需要平滑圆角的组件复用。
 */
import type { MediaKind } from "./model";

export function squirclePath(width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const w = width;
  const h = height;
  const c1 = r * 0.416638;
  const c2 = r * 0.624955;
  const c3 = r * 0.770994;
  const c4 = r * 0.1061;
  const arcR = r * 0.555555;
  const arcD = r * 0.122794;
  const c6 = r * 0.146038;
  const c7 = r * 0.354355;
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `c ${c1} 0 ${c2} 0 ${c3} ${c4}`,
    `a ${arcR} ${arcR} 0 0 1 ${arcD} ${arcD}`,
    `c ${c4} ${c6} ${c4} ${c7} ${c4} ${c3}`,
    `L ${w} ${h - r}`,
    `c 0 ${c1} 0 ${c2} ${-c4} ${c3}`,
    `a ${arcR} ${arcR} 0 0 1 ${-arcD} ${arcD}`,
    `c ${-c6} ${c4} ${-c7} ${c4} ${-c3} ${c4}`,
    `L ${r} ${h}`,
    `c ${-c1} 0 ${-c2} 0 ${-c3} ${-c4}`,
    `a ${arcR} ${arcR} 0 0 1 ${-arcD} ${-arcD}`,
    `c ${-c4} ${-c6} ${-c4} ${-c7} ${-c4} ${-c3}`,
    `L 0 ${r}`,
    `c 0 ${-c1} 0 ${-c2} ${c4} ${-c3}`,
    `a ${arcR} ${arcR} 0 0 1 ${arcD} ${-arcD}`,
    `c ${c6} ${-c4} ${c7} ${-c4} ${c3} ${-c4}`,
    "Z",
  ].join(" ");
}

/**
 * Dock「从画布选」按类型过滤（D-3 IJZY24）：image Dock / 首尾帧只图；video Dock 图视；audio Dock 图视音。
 * 独立于 kinds ports.accept（那是连线规则 connection rule；此处是 Dock 选参考过滤 dock pick filter）。
 */
export function dockAccept(
  mode: "image" | "video" | "audio" | "firstFrame" | "lastFrame",
): MediaKind[] {
  if (mode === "video") return ["image", "video"];
  if (mode === "audio") return ["image", "video", "audio"];
  return ["image"];
}

export function dockPickHint(
  mode: "image" | "video" | "audio" | "firstFrame" | "lastFrame",
  pickableCount: number,
): string {
  const media = mode === "video" ? "图片或视频" : "图片";
  return pickableCount === 0
    ? `画布上还没有可用的${media}`
    : `点击画布中的${media}加入`;
}
