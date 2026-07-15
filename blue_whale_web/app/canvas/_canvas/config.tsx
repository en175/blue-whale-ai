/**
 * Config (JSX) —— 含 JSX 的配置层数据
 * LEFT_TOOLS：左侧工具条按钮配置（含图标 JSX）。
 * NODE_TOOLBAR_ACTIONS：画布素材节点操作菜单配置（含图标 JSX）。
 * 因包含 JSX，须以 .tsx 承载。
 */
import type { ToolDef } from "./types";
import type { ReactNode } from "react";
import { SelectIcon, SparkleIcon, VideoGenIcon } from "./icons";
import {
  AtSign,
  AudioLines,
  Camera,
  Captions,
  Clapperboard,
  Download,
  Info,
  Lightbulb,
  Paintbrush,
  PencilLine,
  RefreshCw,
  Sparkles,
  SquarePlus,
  Type,
  Video,
} from "lucide-react";

export const LEFT_TOOLS: ToolDef[] = [
  { id: "select", label: "选择", icon: <SelectIcon className="text-white" /> },
  { id: "upload", label: "上传", icon: <SquarePlus width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
  { id: "text", label: "文本", icon: <Type width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} />, divider: true },
  { id: "ai-image", label: "AI 图片", icon: <SparkleIcon className="text-white" /> },
  { id: "ai-video", label: "AI 视频", icon: <VideoGenIcon className="text-white" /> },
];
export type NodeToolbarAction = {
  id: string;
  label: string;
  icon: ReactNode;
  /** 纯图标项：只渲染图标，不显示文字（如 信息 / 下载 / 添加到对话）。 */
  iconOnly?: boolean;
};

/** 「清晰化」HD 字母图标（lucide 无对应，自定义 svg；图片/视频菜单共用）。 */
const HdGlyphIcon = (
  <svg width={16} height={16} viewBox="96 96 832 832" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="tc-node-toolbar-icon">
    <path d="M309.333333 341.333333a32 32 0 0 1 32 32v117.333334h85.333334V373.333333a32 32 0 0 1 64 0v277.333334a32 32 0 0 1-64 0V554.666667H341.333333v96a32 32 0 0 1-64 0v-277.333334A32 32 0 0 1 309.333333 341.333333zM586.666667 341.333333a32 32 0 0 0-32 32v277.333334c0 17.664 14.336 32 32 32h42.666666A138.666667 138.666667 0 0 0 768 544v-64A138.666667 138.666667 0 0 0 629.333333 341.333333h-42.666666z m32 277.333334v-213.333334h10.666666c41.216 0 74.666667 33.450667 74.666667 74.666667v64a74.666667 74.666667 0 0 1-74.666667 74.666667h-10.666666z"></path>
    <path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v490.666666A138.666667 138.666667 0 0 1 757.333333 896H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667v490.666666c0 41.216 33.450667 74.666667 74.666667 74.666667h490.666666a74.666667 74.666667 0 0 0 74.666667-74.666667V266.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H266.666667z"></path>
  </svg>
);

export const NODE_TOOLBAR_ACTIONS: NodeToolbarAction[] = [
  { id: "refresh", label: "重新编辑", icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "image", label: "生成图片", icon: <Sparkles width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "video", label: "生成视频", icon: <Video width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "paint", label: "局部重绘", icon: <Paintbrush width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "light", label: "重打光", icon: <Lightbulb width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "upscale", label: "清晰化", icon: HdGlyphIcon },
  { id: "divider", label: "", icon: null },
  { id: "info", label: "信息", icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "download", label: "下载", icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "mention", label: "添加到对话", icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
];

/**
 * 视频节点操作菜单（仿视频编辑工具栏）。
 * 8 个核心编辑动作（功能暂未实现，仅占位）+ 分隔 + 右侧 信息/下载/添加到对话（沿用图片菜单）。
 */
export const NODE_TOOLBAR_VIDEO_ACTIONS: NodeToolbarAction[] = [
  { id: "refresh", label: "重新编辑", icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "video", label: "生成视频", icon: <Video width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "extract-audio", label: "提取音频", icon: <AudioLines width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "remove-caption", label: "去字幕", icon: <Captions width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "upscale", label: "清晰化", icon: HdGlyphIcon },
  { id: "inpaint", label: "局部编辑", icon: <PencilLine width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "snapshot", label: "视频截图", icon: <Camera width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "timeline", label: "添加到时间线", icon: <Clapperboard width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "divider", label: "", icon: null },
  { id: "info", label: "信息", icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "download", label: "下载", icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "mention", label: "添加到对话", icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
];
