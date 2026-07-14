/**
 * generation —— 后端生成 API 请求层
 *
 * 走 Next rewrite /api/* → 网关 → 后端（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 *
 * 字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化（见 application.yml）。
 * streamJob 用 EventSource（SSE），不支持自定义 header，暂不走 apiFetch（待单独处理）。
 */
import { apiFetch } from "@/lib/api-client";

export type ImageModelCapability = {
  model_id: string;
  provider_id: string;
  model_label: string;
  icon: string | null;
  supported_sizes: { id: string; label: string; api_value: string; width?: number; height?: number }[];
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

export type ImageGeneratePayload = {
  prompt: string;
  model_id: string;
  size_id: string;
  aspect_ratio?: string;
  format?: string;
  quantity?: number;
  watermark?: boolean;
  reference_images?: string[];
};

export type VideoGeneratePayload = {
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  first_frame_url?: string;
  last_frame_url?: string;
};

export type ImageResult = { asset_id: number; url: string };
export type ImageGenerateResponse = {
  job_id?: number;
  status?: string;
  stream: boolean;
  asset_id?: number;
  url?: string;
};
export type CreateJobResponse = { job_id: number; status: string };
export type JobAsset = { id: number; url: string; type: string };
export type JobStatusResponse = {
  job_id: number;
  status: string;
  progress: number;
  asset: JobAsset | null;
};

const API_BASE = "/api/agent";

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}${path}`, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("后端未启动或无法连接");
  }
  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`上游响应非 JSON（HTTP ${res.status}）`);
  }
  if (json.code !== 200) {
    throw new Error(json.msg || `上游错误 ${json.code}`);
  }
  return json.data as T;
}

/** 获取当前启用的图片生成模型能力列表。 */
export function getImageModels(): Promise<ImageModelCapability[]> {
  return request<ImageModelCapability[]>("/generation/models?capability=image", "GET");
}

/** 文生图：流式模型返 job_id（再 streamJob 订阅逐张），非流式返 asset_id+url。 */
export function generateImage(payload: ImageGeneratePayload): Promise<ImageGenerateResponse> {
  return request<ImageGenerateResponse>("/generation/image", "POST", payload);
}

/** 图文生视频异步提交，立即返回 jobId。 */
export function createVideoJob(payload: VideoGeneratePayload): Promise<CreateJobResponse> {
  return request<CreateJobResponse>("/generation/video", "POST", payload);
}

/** 轮询查任务状态。 */
export function getJobStatus(jobId: number): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/jobs/${jobId}`, "GET");
}

/** SSE 流式事件载荷（后端 SsePayload，type 区分）。 */
export type StreamEvent =
  | { type: "image"; image_index: number; asset_id: number; url: string }
  | { type: "image_failed"; image_index: number; error_code?: string; error_message?: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; error_code?: string; error_message?: string };

export interface StreamHandlers {
  onImage?: (url: string, assetId: number, imageIndex: number) => void;
  onImageFailed?: (imageIndex: number, code?: string, message?: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/**
 * 订阅流式 job：原生 EventSource 连 `/api/agent/jobs/{id}/stream`，按 data.type 分发。
 * 后端不设 SSE event name，全部走默认 message 通道，onmessage 统一收。
 * 收到 done/error 自动 close；onerror 兜底未收 done 就断。
 */
export function streamJob(jobId: number, handlers: StreamHandlers): EventSource {
  const es = new EventSource(`${API_BASE}/jobs/${jobId}/stream`);
  es.onmessage = (msg) => {
    let event: StreamEvent;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    switch (event.type) {
      case "image":
        handlers.onImage?.(event.url, event.asset_id, event.image_index);
        break;
      case "image_failed":
        handlers.onImageFailed?.(event.image_index, event.error_code, event.error_message);
        break;
      case "done":
        handlers.onDone?.();
        es.close();
        break;
      case "error":
        handlers.onError?.(event.error_message || "生成失败");
        es.close();
        break;
    }
  };
  es.onerror = () => {
    handlers.onError?.("流式连接中断");
    es.close();
  };
  return es;
}
