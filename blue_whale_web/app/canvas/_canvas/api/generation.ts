/**
 * generation —— 后端生成 API 请求层
 *
 * 走 Next rewrite /api/* → 网关 → 后端（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 *
 * 字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化（见 application.yml）。
 */
import { apiRequest } from "@/lib/api-client";
import type { WireInteger } from "@/lib/wire-integer";

export type ImageModelCapability = {
  model_id: string;
  provider_id: string;
  model_label: string;
  icon: string | null;
  supported_sizes: {
    id: string;
    label: string;
    api_value: string;
    width?: number;
    height?: number;
  }[];
  supported_aspect_ratios: string[];
  supported_formats: string[];
  /** 视频时长档（DB supported_durations）；图片模型为 null。 */
  supported_durations: { min: number; max: number; step: number } | null;
  default_size: string;
  default_format: string | null;
  default_aspect_ratio: string;
  /** 视频默认时长（秒）；图片模型为 null。 */
  default_duration: number | null;
  features: {
    reference_image: boolean;
    watermark: boolean;
    quantity_max: number;
    sequential_image_generation: boolean;
    stream: boolean;
    tools: boolean;
    /** 视频首帧引用（图片恒 false）。 */
    first_frame: boolean;
    /** 视频首尾帧引用（图片恒 false）。 */
    first_last_frame: boolean;
    /** 视频带音频（图片恒 false）。 */
    audio: boolean;
  };
};

export type CreateProjectGenerationJobPayload =
  | {
      type: "image";
      input_asset_ids: WireInteger[];
      expected_output_count: number;
      parameters: {
        prompt: string;
        aspect_ratio: string;
        /** 能力表白名单内的模型 id（image 必填，服务端校验）。 */
        model_id: string;
        /** 分辨率档位 id（能力表 supported_sizes[].id，如 2k/3k/4k）。 */
        size: string;
        /** 联网搜索开关（缺省 false）。 */
        web_search: boolean;
        /** 组图模式开关（缺省 false）。 */
        sequential_image_generation: boolean;
      };
    }
  | {
      type: "video";
      expected_output_count: number;
      parameters: {
        prompt: string;
        model_id: string;
        aspect_ratio: string;
        resolution: string;
        duration: number;
      };
      first_frame_asset_id?: WireInteger;
      last_frame_asset_id?: WireInteger;
      reference_asset_ids?: WireInteger[];
    };

export type AcceptedProjectGenerationJob = {
  generation_job_id: WireInteger;
  cursor: WireInteger;
};

const API_BASE = "/api";

async function request<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  // 复用 apiRequest：统一 Result 拆包 + 失败抛 ApiError（保留 code/request_id，IK2BCH）。
  return apiRequest<T>(`${API_BASE}${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** 获取当前启用的图片生成模型能力列表。 */
export function getImageModels(): Promise<ImageModelCapability[]> {
  return request<ImageModelCapability[]>(
    "/generation/models?capability=image",
    "GET",
  );
}

/** BottomDock 单图命令：服务端固定 source，后续结果由 Project Snapshot/SSE 恢复。 */
export function createProjectGenerationJob(
  projectId: WireInteger,
  payload: CreateProjectGenerationJobPayload,
  idempotencyKey: string,
): Promise<AcceptedProjectGenerationJob> {
  return apiRequest<AcceptedProjectGenerationJob>(
    `/api/projects/${projectId}/generation-jobs`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    },
  );
}

/** BottomDock 视频取消命令；状态仍由 Project Snapshot/SSE 恢复。 */
export function cancelProjectGenerationJob(
  projectId: WireInteger,
  generationJobId: WireInteger,
): Promise<void> {
  return apiRequest<void>(
    `/api/projects/${projectId}/generation-jobs/${generationJobId}/cancel`,
    { method: "POST" },
  );
}

/** 为终态 GenerationJob 仅创建缺失/失败输出槽的新任务。 */
export function retryMissingProjectGenerationJobOutputs(
  projectId: WireInteger,
  generationJobId: WireInteger,
  idempotencyKey: string,
): Promise<AcceptedProjectGenerationJob> {
  return apiRequest<AcceptedProjectGenerationJob>(
    `/api/projects/${projectId}/generation-jobs/${generationJobId}/retry`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    },
  );
}

/**
 * 音频生成 payload（IK55VM；签名对齐 image/video，后端音频生成就绪后直接用）。
 * 接口期望（仅供后端日后参考，本次不设计后端）：对齐图/视的 Job 模式，
 * generation-jobs 扩展 mediaKind=audio，settings 形状
 * { mode: "audio" | "music", modelId, prompt, lyrics?, instrumental?, referenceAssetIds[] }。
 */
export type AudioGeneratePayload = {
  prompt: string;
  projectId: WireInteger;
  mode: "audio" | "music";
  modelId?: string;
  lyrics?: string;
  instrumental?: boolean;
  quantity?: number;
  referenceAssetIds?: number[];
};

export type AudioGenerateResponse = {
  url: string;
  assetId: WireInteger;
  jobId?: WireInteger;
};

/**
 * ⚠️ MOCK（IK55VM）：后端暂无音频生成 provider，前端 mock 兜底——
 * 固定延迟 + 固定 sample url + 假 assetId，**不发真请求**。签名对齐 generateImage，
 * 后端音频生成就绪后把实现改为 `request<AudioGenerateResponse>("/generation/audio", "POST", payload)`，
 * 签名不变。sample 用公开音频（TODO：换本地 public/audio/sample.mp3 fixture）。
 */
const MOCK_AUDIO_DELAY_MS = 1500;
const MOCK_AUDIO_SAMPLE_URL =
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
export function generateAudio(
  payload: AudioGeneratePayload,
): Promise<AudioGenerateResponse> {
  void payload; // mock 不消费参数（签名保留供后端真请求）
  const assetId = Math.floor(Date.now() % 900000) + 100000; // 假 assetId（mock，避开真 asset id 段）
  return new Promise((resolve) => {
    setTimeout(
      () => resolve({ url: MOCK_AUDIO_SAMPLE_URL, assetId }),
      MOCK_AUDIO_DELAY_MS,
    );
  });
}

// ---------- Node GenerationJob 轮询 / 列表（IK4AK6 接 Node，取代 v2 老 Java 接口）----------

/** GET /api/jobs/{id} 返回——对齐 Node `handleGetJobStatus` JobStatusData。
 *  succeeded→asset.url 是产物；failed→error；processing→progress。 */
export type JobStatusData = {
  job_id: WireInteger;
  status: string;
  progress: number;
  asset: { id: string; url: string; type: string } | null;
  error: { code: string; message: string; retryable?: boolean } | null;
};

/** 轮询任务状态（image/video 通用，取代 v2 SSE streamJob / getJobStatus 旧骨架）。 */
export function getJobStatus(jobId: WireInteger): Promise<JobStatusData> {
  return apiRequest<JobStatusData>(`/api/jobs/${jobId}`);
}

/** GET /api/jobs 列表项（recover/reconcile 用；对齐 Node JobListItem，snake_case）。 */
export type JobListItem = {
  job_id: WireInteger;
  type: string;
  status: string;
  progress: number;
  input: unknown;
  created_at: string;
  output_assets: {
    id: string;
    url: string;
    type: string;
    width: number | null;
    height: number | null;
  }[];
  error: { code: string; message: string; retryable?: boolean } | null;
};

type JobListPage = {
  records: JobListItem[];
  total: number;
  size: number;
  current: number;
};

/** 列任务（recover processing / reconcile succeeded）；展平 records 数组返回。 */
export function listJobs(opts: {
  projectId?: number | string;
  status?: string;
  size?: number;
  jobIds?: Array<number | string>;
}): Promise<JobListItem[]> {
  const jobIds = opts.jobIds?.map(String) ?? [];
  const qs = new URLSearchParams({
    size: String(opts.size ?? (jobIds.length || 50)),
  });
  if (opts.projectId !== undefined) qs.set("projectId", String(opts.projectId));
  if (opts.status) qs.set("status", opts.status);
  if (jobIds.length > 0) qs.set("ids", jobIds.join(","));
  return request<JobListPage>(`/jobs?${qs.toString()}`, "GET").then(
    (p) => p.records,
  );
}

/** 视频模型能力（capability=video；shape 同 ImageModelCapability——后端共用 ModelCapabilityView）。 */
export function getVideoModels(): Promise<ImageModelCapability[]> {
  return request<ImageModelCapability[]>(
    "/generation/models?capability=video",
    "GET",
  );
}
