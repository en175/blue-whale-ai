/**
 * uiProps —— _canvas UI 层类型（IJZYVQ ARCH-5 拆自原 types.ts）
 *
 * 与 `types/domain.ts` 的边界：
 * - domain.ts  描述「画的是什么」（Project / Asset / NodeItem 等领域形状）
 * - uiProps.ts 描述「怎么画给用户」（工具条定义 / Dock 媒体 / Dock 组件 props）
 *
 * 本文件承载 _canvas 模块 UI 层专有类型。
 */

import type React from "react";

/** 左侧工具条的工具定义 */
export type ToolDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  divider?: boolean;
};

/** 画布素材带入 Dock 时使用的素材形状 */
export type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src?: string;
};

/**
 * Image / Video Dock 共享的「从画布选 / 本地传 / 移除」媒体选择基接口。
 * 抽出来避免两个 Dock Props 重复六个字段；后续新增 AudioDock 也只需 extend。
 */
export type DockMediaPickProps = {
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
  /** 本地上传：Dock 内 file input 选定文件后上抛，由页面层建画布节点 + 入 media */
  onLocalUpload?: (file: File) => void;
  /** 从画布选择：进入画布选择模式 */
  onPickFromCanvas?: () => void;
  /** 退出画布选择模式（再次点触发按钮时 toggle） */
  onExitPick?: () => void;
  /** 当前是否处于「从画布选择」模式（本 Dock 维度） */
  isPicking?: boolean;
};

/** ImageDockContent 组件 Props */
export type ImageDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
} & DockMediaPickProps;

/** VideoDockContent 组件 Props */
export type VideoDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
  refMode: { id: string; label: string };
  setRefMode: (m: { id: string; label: string }) => void;
  refModeOpen: boolean;
  setRefModeOpen: (v: boolean) => void;
  selectedModel: { id: string; label: string };
  setSelectedModel: (m: { id: string; label: string }) => void;
  modelSettingsOpen: boolean;
  setModelSettingsOpen: (v: boolean) => void;
  aspectRatio: { id: string; label: string };
  setAspectRatio: (r: { id: string; label: string }) => void;
  resolution: { id: string; label: string };
  setResolution: (r: { id: string; label: string }) => void;
  duration: number;
  setDuration: (d: number) => void;
  quantity: string;
  setQuantity: (q: string) => void;
  quantityOpen: boolean;
  setQuantityOpen: (v: boolean) => void;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  internetSearch: boolean;
  setInternetSearch: (v: boolean) => void;
} & DockMediaPickProps;
