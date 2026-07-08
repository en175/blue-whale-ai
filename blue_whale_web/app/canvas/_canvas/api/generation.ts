/**
 * generation —— 后端生成 API 请求层
 *
 * 走 Next rewrite /api/* → blue_whale_server:8000（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 *
 * 字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化（见 application.yml）。
 * MVP 无鉴权，X-User-Id 头写死（localStorage 可覆盖）。
 */
export type ImageGeneratePayload = {
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
  quantity?: number;
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
export type CreateJobResponse = { job_id: number; status: string };
export type JobAsset = { id: number; url: string; type: string };
export type JobStatusResponse = {
  job_id: number;
  status: string;
  progress: number;
  asset: JobAsset | null;
};

const API_BASE = "/api";
const DEFAULT_USER_ID = "1";

function userIdHeader(): string {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  return window.localStorage.getItem("bw_user_id") || DEFAULT_USER_ID;
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userIdHeader(),
      },
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

/** 文生图同步生成，返回 asset id + url。 */
export function generateImage(payload: ImageGeneratePayload): Promise<ImageResult> {
  return request<ImageResult>("/generation/image", "POST", payload);
}

/** 图文生视频异步提交，立即返回 jobId。 */
export function createVideoJob(payload: VideoGeneratePayload): Promise<CreateJobResponse> {
  return request<CreateJobResponse>("/generation/video", "POST", payload);
}

/** 轮询查任务状态。 */
export function getJobStatus(jobId: number): Promise<JobStatusResponse> {
  return request<JobStatusResponse>(`/jobs/${jobId}`, "GET");
}
