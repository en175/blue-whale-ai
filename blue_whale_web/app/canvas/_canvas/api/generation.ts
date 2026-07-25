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
  default_size: string;
  default_format: string | null;
  default_aspect_ratio: string;
  features: {
    reference_image: boolean;
    watermark: boolean;
    quantity_max: number;
    sequential_image_generation: boolean;
    stream: boolean;
    tools: boolean;
  };
};

export type CreateProjectGenerationJobPayload = {
  input_asset_ids: number[];
  expected_output_count: number;
} & (
  | {
      type: "image";
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
      parameters: {
        prompt: string;
        aspect_ratio: string;
        resolution: string;
        duration: number;
      };
    }
);

export type AcceptedProjectGenerationJob = {
  generation_job_id: number;
  cursor: number;
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
  projectId: number,
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
  projectId: number,
  generationJobId: number,
): Promise<void> {
  return apiRequest<void>(
    `/api/projects/${projectId}/generation-jobs/${generationJobId}/cancel`,
    { method: "POST" },
  );
}

/** 为终态 GenerationJob 仅创建缺失/失败输出槽的新任务。 */
export function retryMissingProjectGenerationJobOutputs(
  projectId: number,
  generationJobId: number,
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

/** 音频生成 payload（IJZXW7-B；签名对齐 image/video，后端音频生成就绪后直接用）。 */
export type AudioGeneratePayload = {
  prompt: string;
  projectId: number;
  modelId?: string;
  duration?: number;
  sampleRate?: number;
  format?: string;
  referenceAudios?: string[];
  referenceImages?: string[];
  referenceVideos?: string[];
};

export type AudioGenerateResponse = {
  url: string;
  assetId: number;
  jobId?: number;
};

/**
 * ⚠️ MOCK（IJZXW7-B 占位）：后端暂无音频生成 provider，前端 mock 兜底——
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
