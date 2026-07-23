/**
 * Types —— 画布模块的全部类型定义（类型层）
 * 涵盖工具条、节点、视口、聊天消息、项目、Dock 素材及 Dock 内容组件的 Props 类型。
 * 仅承载类型，不包含任何运行时逻辑，供其他模块以 type 方式导入复用。
 */
import type React from "react";
import type { CardStatus } from "@/types/domain";
import type { VideoModelCapability } from "./api/generation";

export type ToolDef = {
  id: string;
  label: string;
  icon: React.ReactNode;
  divider?: boolean;
};

export type NodeType = "image" | "video" | "text";

/**
 * 生成态：loading 生成中（占位）/ ready 就绪 / error 失败。
 * loading | error 不持久化（saveCanvas 过滤），仅 ready 入库。
 */
export type NodeStatus = "loading" | "ready" | "error";

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
  imageUrl?: string;
  /** 关联资产 ID（生成/上传素材的 asset 引用，供持久化恢复与去重） */
  assetId?: number;
  /** v2 工作流：文本节点 prompt（驱动下游 prompt handle） */
  prompt?: string;
  /** v2 工作流入边（serialize edges 聚合到 target；老 /canvas 忽略） */
  references?: Array<{ source: string; sourceHandle?: string; targetHandle?: string }>;
  /** 生成态：loading 占位 / ready 就绪 / error 失败。省略视为 ready（兼容旧数据） */
  status?: NodeStatus;
  /** 失败文案（status=error 时展示） */
  errorMessage?: string;
  /** 视频生成进度（0-100，loading 期展示「生成中 NN%」；临时态不持久化）。 */
  progress?: number;
  selected?: boolean;
};

// 画布素材带入 Dock 时使用的素材形状
export type DockMediaItem = {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src?: string;
  /** 关联资产 ID（预埋：当前参考素材 URL 直传，assetId 为后续统一切 assetId 引用预留，spec D7） */
  assetId?: number;
  /** 上传进度 0-100；undefined = 已完成或在 Dock 缩略图区不显示进度 */
  uploadProgress?: number;
};

/** 重新编辑时从节点 recipe 回填底部栏的参数快照（P2：recipe.generation → Dock 预填）。 */
export type DockPrefill = {
  prompt?: string;
  modelId?: string;
  aspectRatio?: string;
  resolution?: string;
  quantity?: number;
  duration?: number;
  sampleRate?: number;
  format?: string;
  refMode?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  references?: { url: string; kind: "image" | "video" | "audio" }[];
};

/** 预填信号：nonce 递增触发 effect 把 prefill 应用到 Dock（仿 focusSignal/dockMentionSignal）。 */
export type PrefillSignal = { nonce: number; prefill: DockPrefill };

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
  | { id: number | string; type: "card"; text: string; meta: string; collapsed?: boolean; status?: CardStatus };
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

/** 生成设置选项（id+label 形状）。 */
export type SelectOption = { id: string; label: string };

/** 图片 Dock 生成设置（model/resolution/aspectRatio/quantity 在 ImageDockContent 本地 state）。 */
export type ImageGenerateSettings = {
  model: SelectOption;
  resolution: SelectOption;
  aspectRatio: SelectOption;
  quantity: string;
};

/** 音频 Dock 生成设置（IJZXW7-B；模型/参数 mock，后端音频生成就绪换 catalog）。 */
export type AudioGenerateSettings = {
  model: SelectOption;
  duration: number;
  sampleRate: number;
  format: SelectOption;
};

/** 视频 Dock 生成设置（BottomDock 自持 state 透传）。 */
export type VideoGenerateSettings = {
  model: SelectOption;
  resolution: SelectOption;
  aspectRatio: SelectOption;
  duration: number;
  quantity: string;
  refMode: SelectOption;
  /** 首帧 TOS url（首尾帧模式） */
  firstFrameUrl?: string;
  /** 尾帧 TOS url（首尾帧模式） */
  lastFrameUrl?: string;
  /** 全能参考图 url 列表（omni 模式） */
  referenceImages?: string[];
  /** 全能参考视频 url 列表（omni 模式） */
  referenceVideos?: string[];
  /** 全能参考音频 url 列表（omni 模式） */
  referenceAudios?: string[];
};

/** 生成请求参数：discriminated union，按 mode narrow settings。 */
export type GenerateArgs =
  | { mode: "image"; settings: ImageGenerateSettings; referenceImages?: string[] }
  | { mode: "video"; settings: VideoGenerateSettings }
  | { mode: "audio"; settings: AudioGenerateSettings };

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
  /** 点击缩略图预览素材 */
  onPreviewMedia?: (item: DockMediaItem) => void;
  /** 重新编辑预填（P2）：nonce 递增触发 effect 把 recipe 参数应用到图片 Dock 设置 */
  prefillSignal?: PrefillSignal;
};

/** 音频 Dock 内容 props（IJZXW7-B；自持 mock 模型/参数，仿 ImageDockContentProps）。 */
export type AudioDockContentProps = {
  editorRef: React.RefObject<HTMLDivElement | null>;
  isEmpty: boolean;
  onInput: () => void;
  onClose: () => void;
  media?: DockMediaItem[];
  onRemoveMedia?: (id: string) => void;
  /** 本地上传音频：Dock 内 file input 选定文件后上抛，由页面层建画布节点 + 入 media */
  onLocalUpload?: (file: File) => void;
  /** 从画布选择：可选图/视/音节点作参考 */
  onPickFromCanvas?: () => void;
  onExitPick?: () => void;
  isPicking?: boolean;
  onGenerate?: (settings: AudioGenerateSettings) => void;
  generating?: boolean;
  onPreviewMedia?: (item: DockMediaItem) => void;
  prefillSignal?: PrefillSignal;
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
  /** 选中模型（传完整 capability，触发分辨率/比例/时长联动重置）。 */
  onSelectModel: (cap: VideoModelCapability) => void;
  modelSettingsOpen: boolean;
  setModelSettingsOpen: (v: boolean) => void;
  aspectRatio: { id: string; label: string };
  setAspectRatio: (r: { id: string; label: string }) => void;
  resolution: { id: string; label: string };
  setResolution: (r: { id: string; label: string }) => void;
  /** DB 拉取的视频模型能力列表（模型/分辨率/比例/时长下拉的数据源，含联动）。 */
  videoModels: VideoModelCapability[];
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
  /** 首帧 TOS url（首尾帧模式） */
  firstFrameUrl?: string;
  /** 尾帧 TOS url（首尾帧模式） */
  lastFrameUrl?: string;
  /** 首尾帧上传：file + 位置，由页面层上传 TOS 后回填 url */
  onFrameUpload?: (file: File, which: "first" | "last") => void;
  /** 移除首/尾帧 */
  onFrameClear?: (which: "first" | "last") => void;
  /** 交换首尾帧 */
  onSwapFrames?: () => void;
  /** 生成：Dock 内拼装本地 settings 上抛，prompt 由 BottomDock 从 input 取 */
  onGenerate?: (settings: VideoGenerateSettings) => void;
  /** 生成进行中（禁用按钮防重复提交） */
  generating?: boolean;
  /** 点击缩略图预览素材 */
  onPreviewMedia?: (item: DockMediaItem) => void;
};
