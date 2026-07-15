/**
 * generation —— 后端生成 API 请求层
 *
 * 走 Next rewrite /api/* → 网关 → 后端（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 * streamJob 同样走 apiFetch：fetch + ReadableStream 替代原生 EventSource
 * （EventSource 不支持自定义 header，无法带 token 过网关），统一鉴权 + 401 自动刷新。
 *
 * 字段全 camelCase 对齐后端 Jackson 默认序列化（见 application.yml）。
 */
import { apiFetch } from "@/lib/api-client";
import { readSseStream } from "@/lib/sse";

export type ImageModelCapability = {
  modelId: string;
  providerId: string;
  modelLabel: string;
  icon: string | null;
  supportedSizes: { id: string; label: string; apiValue: string; width?: number; height?: number }[];
  supportedAspectRatios: string[];
  supportedFormats: string[];
  defaultSize: string;
  defaultFormat: string | null;
  defaultAspectRatio: string;
  features: {
    referenceImage: boolean;
    watermark: boolean;
    quantityMax: number;
    sequentialImageGeneration: boolean;
    stream: boolean;
    tools: boolean;
  };
};

export type ImageGeneratePayload = {
  prompt: string;
  projectId: number;
  modelId: string;
  sizeId: string;
  aspectRatio?: string;
  format?: string;
  quantity?: number;
  watermark?: boolean;
  referenceImages?: string[];
};

export type VideoGeneratePayload = {
  prompt: string;
  projectId: number;
  modelId?: string;
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
};

export type ImageResult = { assetId: number; url: string };
export type ImageGenerateResponse = {
  jobId?: number;
  status?: string;
  stream: boolean;
  assetId?: number;
  url?: string;
};
export type CreateJobResponse = { jobId: number; status: string };
export type JobAsset = { id: number; url: string; type: string };
export type JobStatusResponse = {
  jobId: number;
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

/** 文生图：流式模型返 jobId（再 streamJob 订阅逐张），非流式返 assetId+url。 */
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

/** 任务列表项（对齐后端 JobListItemDto，camelCase）。 */
export type JobListItem = {
  jobId: number;
  type: string;
  status: string;
  progress: number;
  input: Record<string, unknown> | null;
  createdAt: string;
  outputAssets: { id: number; url: string; type: string; width?: number; height?: number }[] | null;
};

export type ListJobsParams = {
  projectId: number;
  status?: string;
  type?: string;
  page?: number;
  size?: number;
};

/** 后端 Page 序列化形状（MyBatis-Plus {records,total,...}）。 */
type PageData<T> = { records?: T[]; total?: number; size?: number; current?: number };

/**
 * 查任务列表（生成流页 / 刷新恢复）：按 projectId+status 过滤，createdAt 倒序分页。
 * 刷新恢复用 `status=processing` 查跑着的 job，重建画布占位（design D12）。
 */
export async function listJobs(params: ListJobsParams): Promise<JobListItem[]> {
  const qs = new URLSearchParams();
  qs.set("projectId", String(params.projectId));
  if (params.status) qs.set("status", params.status);
  if (params.type) qs.set("type", params.type);
  qs.set("page", String(params.page ?? 1));
  qs.set("size", String(params.size ?? 50));
  const data = await request<PageData<JobListItem> | JobListItem[]>(`/jobs?${qs.toString()}`, "GET");
  return Array.isArray(data) ? data : (data.records ?? []);
}

/** SSE 流式事件载荷（后端 SsePayload，type 区分）。 */
export type StreamEvent =
  | { type: "image"; imageIndex: number; assetId: number; url: string }
  | { type: "image_failed"; imageIndex: number; errorCode?: string; errorMessage?: string }
  | { type: "done"; usage?: unknown }
  | { type: "error"; errorCode?: string; errorMessage?: string };

export interface StreamHandlers {
  onImage?: (url: string, assetId: number, imageIndex: number) => void;
  onImageFailed?: (imageIndex: number, code?: string, message?: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/** 流式订阅句柄：close() 主动断开（AbortController.abort）。 */
export type StreamSubscription = { close(): void };

/**
 * 订阅流式 job：fetch（经 apiFetch 带 token）+ ReadableStream 读 `/api/agent/jobs/{id}/stream`，
 * 按 SSE 帧解析 data.type 分发。后端不设 event name，全走默认 message 通道。
 * 鉴权复用 apiFetch（Authorization + 401 自动刷新）；done/error 自动 abort，
 * 读取异常/断连兜底 onError；close() 主动断开不触发 onError。
 */
export function streamJob(jobId: number, handlers: StreamHandlers): StreamSubscription {
  const controller = new AbortController();
  const run = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/jobs/${jobId}/stream`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        handlers.onError?.(`流式连接失败: ${res.status}`);
        return;
      }
      await readSseStream(res.body.getReader(), (data) => {
        let event: StreamEvent;
        try {
          event = JSON.parse(data) as StreamEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case "image":
            handlers.onImage?.(event.url, event.assetId, event.imageIndex);
            break;
          case "image_failed":
            handlers.onImageFailed?.(event.imageIndex, event.errorCode, event.errorMessage);
            break;
          case "done":
            handlers.onDone?.();
            controller.abort();
            break;
          case "error":
            handlers.onError?.(event.errorMessage || "生成失败");
            controller.abort();
            break;
        }
      });
    } catch {
      if (controller.signal.aborted) return; // 主动 close，静默
      handlers.onError?.("流式连接中断");
    }
  };
  void run();
  return { close: () => controller.abort() };
}
