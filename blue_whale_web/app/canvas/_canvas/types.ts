/**
 * Types —— 画布模块的全部类型定义（类型层）
 * 涵盖工具条、节点、视口、聊天消息、项目、Dock 素材及 Dock 内容组件的 Props 类型。
 * 仅承载类型，不包含任何运行时逻辑，供其他模块以 type 方式导入复用。
 */
import type React from "react";

export type ToolDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  divider?: boolean;
};

export type NodeType = "image" | "text";

export type NodeItem = {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  imageUrl?: string;
  selected?: boolean;
};

// 画布素材带入 Dock 时使用的素材形状
export type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src?: string;
};

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type ChatMessage =
  | { id: number | string; type: "user"; text: string }
  | { id: number | string; type: "agent"; text: string }
  | { id: number | string; type: "thinking"; text: string; content: string }
  | { id: number | string; type: "card"; text: string; meta: string; collapsed?: boolean; status?: "failed" | "normal" };
export type Project = {
  id: string;
  name: string;
  thumb: string | null;
  active?: boolean;
};
export type ImageDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
};

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
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
};
