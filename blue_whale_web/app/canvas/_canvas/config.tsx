/**
 * Config (JSX) —— 含 JSX 的配置层数据
 * LEFT_TOOLS：左侧工具条按钮配置（含图标 JSX）。
 * NODE_TOOLBAR_ACTIONS：画布素材节点操作菜单配置（含图标 JSX）。
 * 因包含 JSX，须以 .tsx 承载。
 */
import type { ToolDef } from "./types";
import type { NodeKindId } from "./model";
import type { ReactNode } from "react";
import { SparkleIcon, VideoGenIcon } from "./icons";
import { AUDIO_SUB_MODES, REFERENCE_CARD_TYPES } from "./constants";
import type { ToolbarFlyoutItem } from "./components/ToolbarFlyout";
import {
  AtSign,
  AudioLines,
  BarChart3,
  Box,
  Download,
  Info,
  Library,
  Lightbulb,
  Mountain,
  MousePointer2,
  Music,
  Package,
  Paintbrush,
  Palette,
  PenLine,
  RefreshCw,
  Shuffle,
  Sparkles,
  SquarePlus,
  Type,
  User,
  Video,
} from "lucide-react";

export const LEFT_TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "选择",
    icon: (
      <MousePointer2
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
  },
  {
    id: "upload",
    label: "上传",
    icon: (
      <SquarePlus
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
  },
  {
    id: "text",
    label: "文本",
    icon: (
      <Type
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
    divider: true,
  },
  {
    id: "ai-image",
    label: "AI 图片",
    icon: <SparkleIcon className="text-white" />,
  },
  {
    id: "ai-video",
    label: "AI 视频",
    icon: <VideoGenIcon className="text-white" />,
  },
  {
    id: "audio",
    label: "音频",
    icon: (
      <AudioLines
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
  },
  {
    id: "asset-library",
    label: "资产库",
    icon: (
      <Library
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
  },
  {
    // IK55VZ：商品卡按钮(toggle 悬浮列表:新建商品/导入商品)
    id: "product-card",
    label: "商品卡",
    icon: (
      <Package
        width={20}
        height={20}
        stroke="rgba(255, 255, 255, 0.8)"
        strokeWidth={1.5}
      />
    ),
  },
];

/**
 * 音频按钮悬浮列表子功能清单（IK55VM）：与音频 Dock 面板内模式切换下拉同一份
 * （id/label 源自 constants.AUDIO_SUB_MODES，此处只补图标 JSX）。
 * 资产库/商品卡后续票复用 ToolbarFlyout 时各自定义自己的清单。
 */
const AUDIO_FLYOUT_ICONS: Record<string, ReactNode> = {
  audio: (
    <AudioLines
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  music: (
    <Music
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
};
export const AUDIO_FLYOUT_ITEMS = AUDIO_SUB_MODES.map((m) => ({
  ...m,
  icon: AUDIO_FLYOUT_ICONS[m.id],
}));

/**
 * 资产库按钮悬浮列表清单（IK55VS）：共享资产(IK55VX 卡片库选择器) + 五类参考卡。
 * id/label 源自 constants.REFERENCE_CARD_TYPES，此处只补图标 JSX（与 AUDIO_FLYOUT_ITEMS 同模式）。
 */
const ASSET_LIBRARY_FLYOUT_ICONS: Record<string, ReactNode> = {
  import: (
    <BarChart3
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  style: (
    <Palette
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  character: (
    <User
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  object: (
    <Box
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  environment: (
    <Mountain
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  custom: (
    <PenLine
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
  product: (
    <Package
      width={15}
      height={15}
      stroke="rgba(255, 255, 255, 0.7)"
      strokeWidth={1.8}
    />
  ),
};
export const ASSET_LIBRARY_FLYOUT_ITEMS: ToolbarFlyoutItem[] = [
  {
    id: "import",
    label: "共享资产",
    icon: ASSET_LIBRARY_FLYOUT_ICONS.import,
  },
  ...REFERENCE_CARD_TYPES.map((t) => ({
    id: t.id as string,
    label: t.flyoutLabel,
    icon: ASSET_LIBRARY_FLYOUT_ICONS[t.id],
  })),
];

/**
 * 商品卡按钮悬浮列表清单（IK55VZ）：新建商品(空卡落视口中心)/导入商品(卡片库选择器
 * cardTypeFilter=["product"])。文案与 constants.REFERENCE_CARD_TYPES product meta 同源。
 */
const PRODUCT_META = REFERENCE_CARD_TYPES.find((t) => t.id === "product")!;
export const PRODUCT_FLYOUT_ITEMS: ToolbarFlyoutItem[] = [
  {
    id: "new",
    label: PRODUCT_META.flyoutLabel,
    icon: (
      <SquarePlus
        width={15}
        height={15}
        stroke="rgba(255, 255, 255, 0.7)"
        strokeWidth={1.8}
      />
    ),
  },
  {
    id: "import",
    label: PRODUCT_META.flyoutImportLabel ?? "导入商品",
    icon: (
      <Download
        width={15}
        height={15}
        stroke="rgba(255, 255, 255, 0.7)"
        strokeWidth={1.8}
      />
    ),
  },
];
export const NODE_TOOLBAR_ACTIONS = [
  {
    id: "refresh",
    label: "重新编辑",
    icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "shuffle",
    label: "再创作",
    icon: <Shuffle width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "mention",
    label: "添加到对话",
    icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  { id: "divider", label: "", icon: null },
  {
    id: "video",
    label: "生成视频",
    icon: <Video width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "paint",
    label: "局部重绘",
    icon: (
      <Paintbrush width={16} height={16} className="tc-node-toolbar-icon" />
    ),
    hidden: true,
  },
  {
    id: "light",
    label: "重打光",
    icon: <Lightbulb width={16} height={16} className="tc-node-toolbar-icon" />,
    hidden: true,
  },
  {
    id: "upscale",
    label: "超分",
    icon: (
      <svg
        width={16}
        height={16}
        viewBox="96 96 832 832"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        className="tc-node-toolbar-icon"
      >
        <path d="M309.333333 341.333333a32 32 0 0 1 32 32v117.333334h85.333334V373.333333a32 32 0 0 1 64 0v277.333334a32 32 0 0 1-64 0V554.666667H341.333333v96a32 32 0 0 1-64 0v-277.333334A32 32 0 0 1 309.333333 341.333333zM586.666667 341.333333a32 32 0 0 0-32 32v277.333334c0 17.664 14.336 32 32 32h42.666666A138.666667 138.666667 0 0 0 768 544v-64A138.666667 138.666667 0 0 0 629.333333 341.333333h-42.666666z m32 277.333334v-213.333334h10.666666c41.216 0 74.666667 33.450667 74.666667 74.666667v64a74.666667 74.666667 0 0 1-74.666667 74.666667h-10.666666z"></path>
        <path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v490.666666A138.666667 138.666667 0 0 1 757.333333 896H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667v490.666666c0 41.216 33.450667 74.666667 74.666667 74.666667h490.666666a74.666667 74.666667 0 0 0 74.666667-74.666667V266.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H266.666667z"></path>
      </svg>
    ),
    hidden: true,
  },
  { id: "divider2", label: "", icon: null },
  {
    id: "info",
    label: "信息",
    icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "download",
    label: "下载",
    icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />,
  },
];

// ---------- v2 节点 toolbar（canvas-v2/nodes.tsx 用；跨模态：图/视/音节点各自操作集）----------
// 与上面老 NODE_TOOLBAR_ACTIONS（老 /canvas v1 用）并存：v2 走 toolbarForKind(kind) 选操作集，
// 老页面继续直接引用 NODE_TOOLBAR_ACTIONS，strangler 互不干扰。
/** v2 toolbar 项类型：icon 必填；iconOnly=true 只渲染图标（无文字）。 */
export type NodeToolbarAction = {
  id: string;
  label: string;
  icon: ReactNode;
  /** 纯图标项：只渲染图标，不显示文字（如 信息 / 下载 / 添加到对话）。 */
  iconOnly?: boolean;
};

/** v2 图片节点操作菜单（跨模态：生成视频/音频）。 */
export const NODE_TOOLBAR_IMAGE_ACTIONS: NodeToolbarAction[] = [
  {
    id: "refresh",
    label: "重新编辑",
    icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "image",
    label: "生成图片",
    icon: <Sparkles width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "video",
    label: "生成视频",
    icon: <Video width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "audio",
    label: "生成音频",
    icon: (
      <AudioLines width={16} height={16} className="tc-node-toolbar-icon" />
    ),
  },
  { id: "divider", label: "", icon: null },
  {
    id: "info",
    label: "信息",
    icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "download",
    label: "下载",
    icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "mention",
    label: "添加到对话",
    icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
];

/** v2 视频节点操作菜单（跨模态：生成视频）。 */
export const NODE_TOOLBAR_VIDEO_ACTIONS: NodeToolbarAction[] = [
  {
    id: "refresh",
    label: "重新编辑",
    icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "video",
    label: "生成视频",
    icon: <Video width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  { id: "divider", label: "", icon: null },
  {
    id: "info",
    label: "信息",
    icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "download",
    label: "下载",
    icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "mention",
    label: "添加到对话",
    icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
];

/** v2 音频节点操作菜单（跨模态：生成视频）。 */
export const NODE_TOOLBAR_AUDIO_ACTIONS: NodeToolbarAction[] = [
  {
    id: "refresh",
    label: "重新编辑",
    icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  {
    id: "video",
    label: "生成视频",
    icon: <Video width={16} height={16} className="tc-node-toolbar-icon" />,
  },
  { id: "divider", label: "", icon: null },
  {
    id: "info",
    label: "信息",
    icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "download",
    label: "下载",
    icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
  {
    id: "mention",
    label: "添加到对话",
    icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />,
    iconOnly: true,
  },
];

/** 按 node kind 选 v2 toolbar（audio→AUDIO / video→VIDEO / else image）。 */
export function toolbarForKind(kind: NodeKindId): NodeToolbarAction[] {
  if (kind === "audio") return NODE_TOOLBAR_AUDIO_ACTIONS;
  if (kind === "video") return NODE_TOOLBAR_VIDEO_ACTIONS;
  return NODE_TOOLBAR_IMAGE_ACTIONS;
}
