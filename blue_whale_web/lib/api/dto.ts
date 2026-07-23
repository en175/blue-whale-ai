/**
 * dto —— 顶层 DTO 类型（IJZYVR API 客户端骨架）
 *
 * 严格对齐 `blue-whale-agent-workspace/BACKEND-API-PRD.md` §5 P0 接口契约。
 *
 * 命名约定:
 * - camelCase（与后端 JSON 一致,不做转换）
 * - 时间字段用 ISO 8601 字符串（PRD §4）
 *
 * 边界:
 * - `messages` / `nodes` 用 `unknown[]` 占位 —— 真实形状由 AGENT-CONVERSATION-PRD +
 *   `skill/references/backend_implementation_contract.md` 权威定义,本骨架不复制;
 *   消费方按各自 feature 引入具体类型
 * - 不收 SSE 事件 schema —— 留给 IJZYVS / 各业务 issue
 * - 不收运行时校验（P0 不引 zod/valibot）
 */

// ---------- §5.1 me ----------
/** `GET /api/me` */
export type MeResponse = {
  userId: string;
  anonymous: true;
  credits: null;
  subscription: null;
};

// ---------- §5.2 assets ----------
/** Asset 文件类型,与后端 storage_kind 对齐。 */
export type AssetKind = "image" | "video";

/** Asset 来源:用户上传 vs 生成产出（同一实体,以来源区分）。 */
export type AssetSource = "uploaded" | "generated";

/** `POST /api/assets/presign` 请求 */
export type PresignAssetRequest = {
  type: AssetKind;
  mime: string;
  size: number;
};

/** `POST /api/assets/presign` 响应 */
export type PresignAssetResponse = {
  assetId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
};

/** `GET /api/agent/assets/{id}` 响应（对齐后端 AssetDto：id 非 assetId，无 status/mime/size） */
export type AssetResponse = {
  id: number | string;
  type: AssetKind;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  source?: string | null;
  createdAt?: string;
};

// ---------- §5.3 catalog ----------
/** `GET /api/catalog` 响应 —— 前端创作参数唯一来源 */
export type CatalogResponse = {
  creationModes: Array<{ id: string; label: string }>;
  videoModels: Array<{ id: string; label: string; costMultiplier: number }>;
  imageModels: Array<{ id: string; label: string; premium: boolean }>;
  agentLlmModels: Array<{ id: string; costMultiplier: number }>;
  videoAspectRatios: string[];
  imageAspectRatios: string[];
  resolutions: string[];
  imageResolutions: string[];
  durations: { min: number; max: number };
  refModes: string[];
};

// ---------- §5.4 generation jobs ----------
/** GenerationJob 类型（image / video）,与 PRD §5.4 type 字段对齐。 */
export type GenerationType = "image" | "video";

/** GenerationJob 来源（dock / agent）—— 区分两条入口链路。 */
export type GenerationSource = "dock" | "agent";

/** Job 状态枚举,与 PRD §5.4 status 字段对齐,亦与 `GenerationJobStatus` 域类型一致。 */
export type JobStatus = "queued" | "processing" | "succeeded" | "failed";

/** 生成参数（与 BottomDock UI 参数一一对应）。 */
export type GenerationParams = {
  aspectRatio: string;
  resolution: string;
  duration: number;
  refMode: string;
  quantity: number;
  internetSearch: boolean;
};

/** `POST /api/projects/{id}/generate` 请求（BottomDock 直生入口） */
export type GenerateRequest = {
  type: GenerationType;
  prompt: string;
  model: string;
  params: GenerationParams;
  referenceAssetIds: string[];
  source: GenerationSource;
};

/** `POST /api/projects/{id}/generate` 响应 */
export type GenerateResponse = {
  jobId: string;
  status: JobStatus;
};

/** `GET /api/jobs/{id}` 响应 / `GET /api/projects/{id}` 中 activeJobs 元素 */
export type JobResponse = {
  jobId: string;
  projectId: string;
  type: GenerationType;
  status: JobStatus;
  progress: number;
  outputAssetIds: string[];
  error: { code: string; message: string; detail?: unknown } | null;
  createdAt: string;
  updatedAt: string;
};

// ---------- §5.5 projects ----------
/** Project 列表项（TopBar `PROJECTS` 数据来源,替换硬编码）。 */
export type ProjectSummary = {
  id: string;
  title: string;
  coverAssetId: string | null;
  updatedAt: string;
};

/** `GET /api/projects` 响应 */
export type ListProjectsResponse = {
  items: ProjectSummary[];
};

/** 画布聚合状态（PRD §5.5 `canvasState`） */
export type CanvasStateDto = {
  nodes: unknown[];
  viewport: Record<string, unknown>;
};

/** `POST /api/projects` 请求 */
export type CreateProjectRequest = {
  title: string;
  initialPrompt?: string;
};

/** `POST /api/projects` 响应 */
export type CreateProjectResponse = {
  id: string;
  title: string;
  canvasState: CanvasStateDto;
  messages: unknown[];
  createdAt: string;
};

/** `PATCH /api/projects/{id}` 请求 */
export type PatchProjectRequest = {
  title?: string;
  canvasState?: CanvasStateDto;
  messages?: unknown[];
};

/** `GET /api/projects/{id}` 响应（恢复整个工作区 + 进行中任务） */
export type GetProjectResponse = {
  id: string;
  title: string;
  canvasState: CanvasStateDto;
  messages: unknown[];
  activeJobs: JobResponse[];
  updatedAt: string;
};
