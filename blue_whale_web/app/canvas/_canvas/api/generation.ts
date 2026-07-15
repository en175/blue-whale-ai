/**
 * generation —— 后端生成 API 请求层
 *
 * 走 Next rewrite /api/* → 网关 → 后端（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 *
 * 字段全 snake_case 对齐后端 Jackson SNAKE_CASE 序列化（见 application.yml）。
 */
import { apiFetch, apiRequest } from "@/lib/api-client";

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
  expected_output_count: 1;
} & (
  | {
      type: "image";
      parameters: {
        prompt: string;
        aspect_ratio: string;
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
