/**
 * Constants —— 画布模块的静态常量配置（配置层，纯数据无 JSX）
 * 包含工具条面板/按钮的 SVG 路径、示例项目列表、视频生成模型/宽高比/分辨率/时长等配置。
 */
import type { Project } from "./types";

export const TOOLBAR_PANEL_PATH =
  "M 18 0 L 30 0 c 7.4995 0 11.2492 0 13.8779 1.9098 a 10 10 0 0 1 2.2123 2.2123 c 1.9098 2.6287 1.9098 6.3784 1.9098 13.8779 L 48 18 L 48 272 c 0 7.4995 0 11.2492 -1.9098 13.8779 a 10 10 0 0 1 -2.2123 2.2123 c -2.6287 1.9098 -6.3784 1.9098 -13.8779 1.9098 L 30 290 L 18 290 c -7.4995 0 -11.2492 0 -13.8779 -1.9098 a 10 10 0 0 1 -2.2123 -2.2123 c -1.9098 -2.6287 -1.9098 -6.3784 -1.9098 -13.8779 L 0 272 L 0 18 c 0 -7.4995 0 -11.2492 1.9098 -13.8779 a 10 10 0 0 1 2.2123 -2.2123 c 2.6287 -1.9098 6.3784 -1.9098 13.8779 -1.9098 Z";

export const TOOLBAR_BUTTON_PATH =
  "M 10.8 0 L 21.2 0 c 4.4997 0 6.7495 0 8.3267 1.1459 a 6 6 0 0 1 1.3274 1.3274 c 1.1459 1.5772 1.1459 3.827 1.1459 8.3267 L 32 10.8 L 32 21.2 c 0 4.4997 0 6.7495 -1.1459 8.3267 a 6 6 0 0 1 -1.3274 1.3274 c -1.5772 1.1459 -3.827 1.1459 -8.3267 1.1459 L 21.2 32 L 10.8 32 c -4.4997 0 -6.7495 0 -8.3267 -1.1459 a 6 6 0 0 1 -1.3274 -1.3274 c -1.1459 -1.5772 -1.1459 -3.827 -1.1459 -8.3267 L 0 21.2 L 0 10.8 c 0 -4.4997 0 -6.7495 1.1459 -8.3267 a 6 6 0 0 1 1.3274 -1.3274 c 1.5772 -1.1459 3.827 -1.1459 8.3267 -1.1459 Z";
/**
 * 初始示例项目集合（DEMO 内存态 mock）。
 *
 * Project 现为顶层聚合根（见 CONTEXT.md L44–50）：每个项目自带 Canvas（节点+视口）
 * 与对话消息流。project "1" 承载从 AgentChatPanel 迁来的初始对话（id 1–4），其余
 * 项目给空画布以便手测时区分「切换项目 = 同时更换画布节点集合与对话历史」。
 *
 * thumb 全部置 null：规避 unsplash 远程图床与 next.config.ts 仅允许 CloudFront 的
 * 白名单冲突（DEMO 阶段统一用占位图标渲染，见 ProjectMenu）。
 */
const EMPTY_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export const PROJECTS: Project[] = [
  {
    id: "1",
    name: "小猫创作",
    thumb: null,
    active: true,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [
      { id: 1, type: "user", text: "生成一个小猫" },
      {
        id: 2,
        type: "thinking",
        text: "思考过程",
        content:
          'The user wants to generate an image of a kitten. This is a simple, direct image generation request in Instant mode. Let me follow the workflow:\n\n1. This is a direct final prompt for image generation - "生成一个小猫" (generate a kitten)\n2. I need to load the direct workflow and output-card-image skill\n3. For image requests, I create ImageCard task cards directly without preview/confirmation\n\nLet me first set the display language (user is writing in Chinese), then view the necessary skills, and create the image card directly.\n\nThe user\'s language is zh-CN based on "生成一个小猫".\n\nLet me view the workflow and output skill, then create the image card.\nThe user wants to generate an image of a kitten ("生成一个小猫"). This is a direct image generation request in Instant mode. According to the workflow, ImageCards skip preview and approval - I should create the card directly.\n\nLet me call plan_output_kinds and then image_card_output_fn directly.',
      },
      {
        id: 3,
        type: "agent",
        text: "正在为你生成一张可爱的小猫图片 🐱\n\n\n\n",
      },
      {
        id: 4,
        type: "card",
        text: "一只毛茸茸的小猫咪，大大的圆眼睛，柔软的毛发，表情呆萌可爱，自然光线柔和，浅景深特写，温暖治愈的氛围，高清细节",
        meta: "1:1",
        collapsed: false,
        status: "failed",
      },
    ],
  },
  {
    id: "2",
    name: "城市夜景",
    thumb: null,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [
      { id: 1, type: "user", text: "生成赛博朋克城市夜景" },
      { id: 2, type: "agent", text: "正在构思霓虹灯光与雨夜街道的氛围…" },
    ],
  },
  {
    id: "3",
    name: "产品摄影",
    thumb: null,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [],
  },
  {
    id: "4",
    name: "草稿项目",
    thumb: null,
    canvas: { nodes: [], viewport: EMPTY_VIEWPORT },
    messages: [],
  },
];
export const VIDEO_MODELS = [{ id: "seedance-2", label: "Seedance 2.0" }];

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
];

export const VIDEO_DURATION_MIN = 4;
export const VIDEO_DURATION_MAX = 15;
export const VIDEO_DURATION_STEP = 1;
export const VIDEO_DURATION_TICKS = Array.from(
  {
    length: (VIDEO_DURATION_MAX - VIDEO_DURATION_MIN) / VIDEO_DURATION_STEP + 1,
  },
  (_, i) => VIDEO_DURATION_MIN + i * VIDEO_DURATION_STEP,
);

export const REF_MODES = [
  { id: "omni", label: "全能参考" },
  { id: "first-last", label: "首尾帧" },
];

export const QUANTITIES = ["1x", "2x", "3x", "4x"];
