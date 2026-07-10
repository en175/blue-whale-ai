/**
 * domain —— 顶层领域类型聚合（IJZYVQ ARCH-5）
 *
 * 按 `CONTEXT.md` 术语表统一命名，所有跨模块共享的领域类型在此集中定义：
 *   - Project       顶层聚合根
 *   - Canvas        节点集合 + 视口，归属 Project
 *   - NodeItem      画布上的素材单元（图片/文本节点）
 *   - ChatMessage   对话消息流（user / agent / thinking / card）
 *   - Card          ChatMessage 的 card 变体，结果在对话流里的视图
 *   - Asset         图片/视频文件实体（被 Card / NodeItem 引用）
 *   - GenerationJob 后台生成任务（Card 的视图状态由 Job 映射）
 *
 * 拆自原 `app/canvas/_canvas/types.ts`，原文件改为 re-export 兼容层（IJZYVQ）。
 *
 * 边界（严格对齐 CONTEXT.md L64-82）：
 * - 本文件只承载「领域形状」与「Card → Job 视图映射」用到的状态枚举
 * - 字段定义不超出 CONTEXT.md：Asset 只含 image/video（不引 audio 以保领域纯粹）
 * - UI 层数据形状（ToolDef / DockMediaItem / *DockContentProps）归 `app/canvas/_canvas/uiProps.ts`
 * - UI 文本/标签（如 JobStatus 中文）归 UI 层
 * - 不引入运行时校验（zod/valibot），留待后端对接阶段
 */

// ---------- Card 状态枚举（CONTEXT.md L52：generating → normal | failed）----------

/**
 * Card 生命周期状态机。
 * 状态转移见 `_canvas/cardStatus.ts` 的 `nextRetryStatus` 函数。
 */
export type CardStatus = "failed" | "generating" | "normal";

// ---------- GenerationJob 状态枚举（CONTEXT.md L74）----------

/**
 * GenerationJob 生命周期状态机。
 *   queued → processing → succeeded | failed
 * 后台持久化，刷新页面/切 Project 后任务仍继续（CONTEXT.md L77）。
 */
export type GenerationJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed";

// ---------- Asset（CONTEXT.md L64-72）----------

/**
 * 资产：图片或视频文件实体（CONTEXT.md L66 明确限定）。
 * 后端独立存储，有自己的 id 与可访问 URL；访问 URL 会过期，由后端按需重新签发。
 *
 * 同一 Asset 可被多个视图引用（Card + NodeItem 是同一结果的两种视图）。
 * 既包含用户上传素材（source=uploaded），也包含生成产出（source=generated）。
 */
export type Asset = {
  id: string;
  /** 文件类型。CONTEXT.md L66 限定为图片/视频。 */
  kind: "image" | "video";
  /** 后端可访问 URL（过期由后端重新签发） */
  url: string;
  /** 过期时间戳（ms epoch）；可选，未设表示后端按需签发。CONTEXT.md L70 */
  expiresAt?: number;
  /** 来源：用户上传 vs 生成产出。CONTEXT.md L69-70 */
  source: "uploaded" | "generated";
};

// ---------- GenerationJob（CONTEXT.md L74-82）----------

/**
 * 后台生成任务。
 * 任务在后台持久化（CONTEXT.md L77）；产出物是一个 Asset，通过 Card / NodeItem 呈现。
 */
export type GenerationJob = {
  id: string;
  /** 任务状态 */
  status: GenerationJobStatus;
  /** 产出 Asset id（status=succeeded 时填） */
  resultAssetId?: string;
  /** 任务创建时间（ms epoch） */
  createdAt: number;
};

// ---------- NodeItem（CONTEXT.md L22-24）----------

export type NodeType = "image" | "text";

/**
 * 画布上的素材单元（图片或文本节点）。
 * NodeItem 与 Card 是同一生成结果的两种视图（CONTEXT.md L26-30）。
 */
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

// ---------- Viewport / Canvas（CONTEXT.md L49）----------

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

/**
 * 画布聚合：节点集合 + 视口。
 * 归属 Project（CONTEXT.md L49），切换 Project 即更换此集合。
 */
export type Canvas = {
  nodes: NodeItem[];
  viewport: Viewport;
};

// ---------- ChatMessage + Card（CONTEXT.md L26-30）----------

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
      /** Card 视图状态；与 GenerationJob 状态的视图映射见 `lib/jobs.ts` */
      status?: CardStatus;
    };

/**
 * Card —— 对话消息的 card 变体。
 * "Card 与 NodeItem 是同一生成结果的两种视图"（CONTEXT.md L26-30）：
 *   Card 是结果在对话流里的呈现，NodeItem 是结果在画布上的呈现。
 */
export type Card = Extract<ChatMessage, { type: "card" }>;

// ---------- Project（CONTEXT.md L44-50）----------

/**
 * 项目，顶层聚合根。
 * 一个 Project 包含一个 Canvas 及其 AgentChatPanel 对话历史（CONTEXT.md L45）。
 * 切换 Project 即切换画布与对话。
 */
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