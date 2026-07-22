/**
 * Config (JSX) —— 含 JSX 的配置层数据
 * LEFT_TOOLS：左侧工具条按钮配置（含图标 JSX）。
 * NODE_TOOLBAR_ACTIONS：画布素材节点操作菜单配置（含图标 JSX）。
 * 因包含 JSX，须以 .tsx 承载。
 */
import type { ToolDef } from "./types";
import type { ReactNode } from "react";
import { Cube3DIcon, SelectIcon, SparkleIcon, VideoGenIcon, WhiteboardIcon } from "./icons";
import {
  AtSign,
  AudioLines,
  Download,
  GalleryVerticalEnd,
  Info,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Type,
  Upload,
  Video,
} from "lucide-react";

// 分组对齐竞品 topview.ai 左侧栏（2-6-2 结构）：
//   组1 基础操作：选择 / 上传
//   组2 内容生成：AI 图片 / AI 视频 / 音频 / 文字 / 3D / 白板
//   组3 管理：资产 / 商品卡片
// divider 渲染在按钮下方：落在「上传」「白板」之后。
// 注：音频 / 3D / 白板 / 资产 / 商品卡片 后端未接，点击占位
//     （page.tsx handleToolClick 无对应 case → noop），仅前端图标展示。
export const LEFT_TOOLS: ToolDef[] = [
  { id: "select", label: "选择", icon: <SelectIcon className="text-white" /> },
  { id: "upload", label: "上传", icon: <Upload width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} />, divider: true },
  { id: "ai-image", label: "AI 图片", icon: <SparkleIcon className="text-white" /> },
  { id: "ai-video", label: "AI 视频", icon: <VideoGenIcon className="text-white" /> },
  { id: "audio", label: "音频", icon: <AudioLines width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
  { id: "text", label: "文本", icon: <Type width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
  { id: "3d", label: "3D", icon: <Cube3DIcon className="text-white" /> },
  { id: "whiteboard", label: "白板", icon: <WhiteboardIcon className="text-white" />, divider: true },
  { id: "assets", label: "资产", icon: <GalleryVerticalEnd width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
  { id: "product-card", label: "商品卡片", icon: <ShoppingBag width={20} height={20} stroke="rgba(255, 255, 255, 0.8)" strokeWidth={1.5} /> },
];
export type NodeToolbarAction = {
  id: string;
  label: string;
  icon: ReactNode;
  /** 纯图标项：只渲染图标，不显示文字（如 信息 / 下载 / 添加到对话）。 */
  iconOnly?: boolean;
};

export const NODE_TOOLBAR_ACTIONS: NodeToolbarAction[] = [
  { id: "refresh", label: "重新编辑", icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "image", label: "生成图片", icon: <Sparkles width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "video", label: "生成视频", icon: <Video width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "divider", label: "", icon: null },
  { id: "info", label: "信息", icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "download", label: "下载", icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "mention", label: "添加到对话", icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
];

/** 视频节点操作菜单。 */
export const NODE_TOOLBAR_VIDEO_ACTIONS: NodeToolbarAction[] = [
  { id: "refresh", label: "重新编辑", icon: <RefreshCw width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "video", label: "生成视频", icon: <Video width={16} height={16} className="tc-node-toolbar-icon" /> },
  { id: "divider", label: "", icon: null },
  { id: "info", label: "信息", icon: <Info width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "download", label: "下载", icon: <Download width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
  { id: "mention", label: "添加到对话", icon: <AtSign width={16} height={16} className="tc-node-toolbar-icon" />, iconOnly: true },
];
