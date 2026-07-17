/**
 * Types —— 画布模块的全部类型定义（类型层）
 * 涵盖工具条、节点、视口、聊天消息、项目、Dock 素材及 Dock 内容组件的 Props 类型。
 * 仅承载类型，不包含任何运行时逻辑，供其他模块以 type 方式导入复用。
 */
import type React from "react";
import type { CardStatus } from "@/types/domain";

export type ToolDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  divider?: boolean;
};

export type NodeType = "image" | "video" | "text";

/**
 * 画布节点。坐标语义对齐 React Flow：world 坐标由 {@link position} 承载
 * （替代原自研 x/y），resize 由 RF `NodeResizer` 驱动 width/height。
 * `rotation`/`zIndex` 为迁移新增（旋转与图层排序，原实现未覆盖）。
 */
export type NodeItem = {
  id: string;
  type: NodeType;
  /** world 坐标（RF `node.position`，替代原 x/y 字段） */
  position: { x: number; y: number };
  width: number;
  height: number;
  /** 旋转角度（度），默认 0 */
  rotation?: number;
  /** 图层排序，数值越大越靠前（bring-to-front 写入） */
  zIndex?: number;
  content?: string;
  /** 对应不可变 Asset；Card 与 NodeItem 以此共享生成结果身份。 */
  assetId?: string;
  imageUrl?: string;
  /** 视频资产的稳定鉴权入口；签名 URL 仅由播放器保存在内存中。 */
  assetAccessUrl?: string;
  selected?: boolean;
};

// 画布素材带入 Dock 时使用的素材形状
export type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  /** 后端不可变 Asset 身份；生成命令不接受临时媒体 URL 充当输入身份。 */
  assetId?: string;
  src?: string;
};

/** 视口。字段对齐 RF `Viewport`：`scale` 改名 `zoom`（BREAKING，见 design D5）。 */
export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type ChatMessage =
  | { id: number | string; type: "user"; text: string }
  | { id: number | string; type: "agent"; text: string }
  | { id: number | string; type: "thinking"; text: string; content: string }
  | {
      id: number | string;
      type: "card";
      text: string;
      meta: string;
      collapsed?: boolean;
      status?: CardStatus;
      assetId?: string;
      imageUrl?: string;
      /** 权威 GenerationJob 身份；失败 Card 以此触发缺失槽重试。 */
      generationJobId?: number | string;
      /** Card 对应的稳定输出槽。 */
      slotIndex?: number;
      /** 产品规范化失败文案（来自后端公开错误信封）；失败 Card 向 User 展示，不泄漏内部信息。 */
      errorMessage?: string;
    };
/**
 * Canvas —— 画布聚合（提为具名类型）。
 * 节点集合 + 视口，归属于 Project（见 CONTEXT.md L44–50）。
 */
export type Canvas = {
  nodes: NodeItem[];
  viewport: Viewport;
};

export type Project = {
  id: string;
  name: string;
  thumb: string | null;
  /** 画布聚合：节点集合 + 视口。切换 Project 即更换此集合。 */
  canvas: Canvas;
  /**
   * 对话消息流。归属 Project 不归属 Canvas（领域决策，CONTEXT.md L50）——
   * 切换项目同时更换对话历史。
   */
  messages: ChatMessage[];
  active?: boolean;
};

/** 生成设置选项（id+label 形状，与 constants 里的 VIDEO_MODELS 等一致）。 */
export type SelectOption = { id: string; label: string };

/** 图片 Dock 生成设置（model/resolution/aspectRatio/quantity 在 ImageDockContent 本地 state）。 */
export type ImageGenerateSettings = {
  model: SelectOption;
  resolution: SelectOption;
  aspectRatio: SelectOption;
  quantity: string;
};

/** 视频 Dock 生成设置（BottomDock 自持 state 透传）。 */
export type VideoGenerateSettings = {
  model: SelectOption;
  resolution: SelectOption;
  aspectRatio: SelectOption;
  duration: number;
  quantity: string;
  refMode: SelectOption;
};

/** 生成请求参数：discriminated union，按 mode narrow settings。 */
export type GenerateArgs =
  | { mode: "image"; settings: ImageGenerateSettings }
  | { mode: "video"; settings: VideoGenerateSettings };

export type ImageDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
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
  /** 生成：Dock 内拼装本地 settings 上抛，prompt 由 BottomDock 从 input 取 */
  onGenerate?: (settings: ImageGenerateSettings) => void;
  /** 生成进行中（禁用按钮防重复提交） */
  generating?: boolean;
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
  /** 本地上传：Dock 内 file input 选定文件后上抛，由页面层建画布节点 + 入 media */
  onLocalUpload?: (file: File) => void;
  /** 从画布选择：进入画布选择模式 */
  onPickFromCanvas?: () => void;
  /** 退出画布选择模式（再次点触发按钮时 toggle） */
  onExitPick?: () => void;
  /** 当前是否处于「从画布选择」模式（本 Dock 维度） */
  isPicking?: boolean;
  /** 生成：Dock 内拼装本地 settings 上抛，prompt 由 BottomDock 从 input 取 */
  onGenerate?: (settings: VideoGenerateSettings) => void;
  /** 生成进行中（禁用按钮防重复提交） */
  generating?: boolean;
};
