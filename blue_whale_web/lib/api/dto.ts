/**
 * dto —— 顶层 DTO 类型（IJZYVR API 客户端骨架）
 *
 * 严格对齐 `docs/archive/agent-workspace/BACKEND-API-PRD.md` §5 P0 接口契约。
 *
 * 命名约定:
 * - snake_case（与后端 JSON 一致,不做转换）
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
  user_id: string;
  anonymous: true;
  credits: null;
  subscription: null;
};

// ---------- §5.2 assets ----------
/** Asset 文件类型,与后端 storage_kind 对齐。 */
export type AssetKind = "image" | "video" | "audio";

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
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
};

/** `POST /api/agent/assets/uploads/complete` 请求 */
export type CompleteAssetRequest = PresignAssetRequest & {
  project_id?: string;
  storage_key: string;
  width?: number;
  height?: number;
  duration?: number;
};

/** `POST /api/assets/{id}/complete` + `GET /api/assets/{id}` 响应 */
export type AssetResponse = {
  asset_id: string;
  status: "uploading" | "ready" | "failed";
  type: AssetKind;
  url: string;
  width: number;
  height: number;
  duration: number | null;
  mime: string;
  size: number;
};

// ---------- §5.3 catalog ----------
/** `GET /api/catalog` 响应 —— 前端创作参数唯一来源 */
export type CatalogResponse = {
  creation_modes: Array<{ id: string; label: string }>;
  video_models: Array<{ id: string; label: string; cost_multiplier: number }>;
  image_models: Array<{ id: string; label: string; premium: boolean }>;
  agent_llm_models: Array<{ id: string; cost_multiplier: number }>;
  video_aspect_ratios: string[];
  image_aspect_ratios: string[];
  resolutions: string[];
  image_resolutions: string[];
  durations: { min: number; max: number };
  ref_modes: string[];
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
  aspect_ratio: string;
  resolution: string;
  duration: number;
  ref_mode: string;
  quantity: number;
  internet_search: boolean;
};

/** `POST /api/projects/{id}/generate` 请求（BottomDock 直生入口） */
export type GenerateRequest = {
  type: GenerationType;
  prompt: string;
  model: string;
  params: GenerationParams;
  reference_asset_ids: string[];
  source: GenerationSource;
};

/** `POST /api/projects/{id}/generate` 响应 */
export type GenerateResponse = {
  job_id: string;
  status: JobStatus;
};

/** 面向 API / Job / SSE 消费者的安全错误信封。 */
export type PublicErrorEnvelope = {
  code: string;
  message: string;
  retryable: boolean;
  retry_after_seconds: number | null;
  input_request_id: number | null;
  budget_effect: string;
};

/** `GET /api/jobs/{id}` 响应 / `GET /api/projects/{id}` 中 active_jobs 元素 */
export type JobResponse = {
  job_id: string;
  project_id: string;
  type: GenerationType;
  status: JobStatus;
  progress: number;
  output_asset_ids: string[];
  error: PublicErrorEnvelope | null;
  created_at: string;
  updated_at: string;
};

// ---------- §5.5 projects ----------
/** Project 列表项（TopBar `PROJECTS` 数据来源,替换硬编码）。 */
export type ProjectSummary = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  updated_at: string;
};

/** `GET /api/projects` 响应 */
export type ListProjectsResponse = {
  items: ProjectSummary[];
};

/** 画布聚合状态（PRD §5.5 `canvas_state`） */
export type CanvasStateDto = {
  nodes: unknown[];
  viewport: Record<string, unknown>;
};

/** `POST /api/projects` 请求 */
export type CreateProjectRequest = {
  title: string;
  initial_prompt?: string;
};

/** `POST /api/projects` 响应 */
export type CreateProjectResponse = {
  id: string;
  title: string;
  canvas_state: CanvasStateDto;
  messages: unknown[];
  created_at: string;
};

/** `PATCH /api/projects/{id}` 请求 */
export type PatchProjectRequest = {
  title?: string;
  canvas_state?: CanvasStateDto;
  messages?: unknown[];
};

/** `GET /api/projects/{id}` 响应（恢复整个工作区 + 进行中任务） */
export type GetProjectResponse = {
  id: string;
  title: string;
  canvas_state: CanvasStateDto;
  messages: unknown[];
  active_jobs: JobResponse[];
  updated_at: string;
};
