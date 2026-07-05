/**
 * Constants —— 画布模块的静态常量配置（配置层，纯数据无 JSX）
 * 包含工具条面板/按钮的 SVG 路径、示例项目列表、视频生成模型/宽高比/分辨率/时长等配置。
 */
import type { Project } from "./types";

export const TOOLBAR_PANEL_PATH =
  "M 18 0 L 30 0 c 7.4995 0 11.2492 0 13.8779 1.9098 a 10 10 0 0 1 2.2123 2.2123 c 1.9098 2.6287 1.9098 6.3784 1.9098 13.8779 L 48 18 L 48 272 c 0 7.4995 0 11.2492 -1.9098 13.8779 a 10 10 0 0 1 -2.2123 2.2123 c -2.6287 1.9098 -6.3784 1.9098 -13.8779 1.9098 L 30 290 L 18 290 c -7.4995 0 -11.2492 0 -13.8779 -1.9098 a 10 10 0 0 1 -2.2123 -2.2123 c -1.9098 -2.6287 -1.9098 -6.3784 -1.9098 -13.8779 L 0 272 L 0 18 c 0 -7.4995 0 -11.2492 1.9098 -13.8779 a 10 10 0 0 1 2.2123 -2.2123 c 2.6287 -1.9098 6.3784 -1.9098 13.8779 -1.9098 Z";

export const TOOLBAR_BUTTON_PATH =
  "M 10.8 0 L 21.2 0 c 4.4997 0 6.7495 0 8.3267 1.1459 a 6 6 0 0 1 1.3274 1.3274 c 1.1459 1.5772 1.1459 3.827 1.1459 8.3267 L 32 10.8 L 32 21.2 c 0 4.4997 0 6.7495 -1.1459 8.3267 a 6 6 0 0 1 -1.3274 1.3274 c -1.5772 1.1459 -3.827 1.1459 -8.3267 1.1459 L 21.2 32 L 10.8 32 c -4.4997 0 -6.7495 0 -8.3267 -1.1459 a 6 6 0 0 1 -1.3274 -1.3274 c -1.1459 -1.5772 -1.1459 -3.827 -1.1459 -8.3267 L 0 21.2 L 0 10.8 c 0 -4.4997 0 -6.7495 1.1459 -8.3267 a 6 6 0 0 1 1.3274 -1.3274 c 1.5772 -1.1459 3.827 -1.1459 8.3267 -1.1459 Z";
export const PROJECTS: Project[] = [
  {
    id: "1",
    name: "2026-06-30 09:54",
    thumb: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&h=120&fit=crop",
    active: true,
  },
  {
    id: "2",
    name: "2026-06-29 16:13",
    thumb: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=120&h=120&fit=crop",
  },
  {
    id: "3",
    name: "2026-06-26 03:18",
    thumb: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=120&h=120&fit=crop",
  },
  { id: "4", name: "2026-06-25 16:51", thumb: null },
];
export const VIDEO_MODELS = [
  { id: "seedance-2", label: "Seedance 2.0" },
  { id: "seedance-mini", label: "Seedance 2.0 Mini" },
  { id: "seedance-fast", label: "Seedance 2.0 Fast" },
];

export const VIDEO_ASPECT_RATIOS = [
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
  { id: "21:9", label: "21:9" },
];

export const VIDEO_RESOLUTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "2160p", label: "2160p" },
];

export const VIDEO_DURATION_MIN = 4;
export const VIDEO_DURATION_MAX = 15;
export const VIDEO_DURATION_STEP = 1;
export const VIDEO_DURATION_TICKS = Array.from(
  { length: (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN) / VIDEO_DURATION_STEP + 1 },
  (_, i) => VIDEO_DURATION_MIN + i * VIDEO_DURATION_STEP,
);

export const REF_MODES = [
  { id: "omni", label: "全能参考" },
  { id: "first-last", label: "首尾帧" },
];

export const QUANTITIES = ["1x", "2x", "3x", "4x"];
