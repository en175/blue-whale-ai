export interface NewApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface NewApiLoginInput {
  username: string;
  password: string;
}

export interface NewApiLoginResult {
  token: string;
  userId: number | null;
  username: string | null;
}

export interface NewApiUsage {
  userQuota: number;
  raw: unknown;
}

export interface NewApiLog {
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  model_name?: string;
  created_at?: number | string;
  [key: string]: unknown;
}

export interface NewApiImageInput {
  model: string;
  prompt: string;
  size?: string | null;
  n: number;
  webSearch?: boolean;
}

export interface NewApiImage {
  url: string;
  [key: string]: unknown;
}

export interface NewApiImageEditInput {
  model: string;
  prompt: string;
  image: Blob;
  fileName: string;
  size?: string | null;
  n: number;
}

export interface NewApiVideoInput {
  model: string;
  prompt: string;
  image?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  referenceImages?: string[];
  duration: number;
  width: number;
  height: number;
  responseFormat?: "url";
}

export interface NewApiVideoSubmission {
  taskId: string;
  status: string;
}

export interface NewApiVideoTask {
  taskId: string;
  status: string;
  url: string | null;
  error: { code: string | number | null; message: string } | null;
}

export class NewApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string | number,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "NewApiError";
  }
}

type NewApiEnvelope = {
  success?: boolean;
  code?: boolean | number | string;
  message?: string;
  msg?: string;
  error?: {
    code?: boolean | number | string;
    message?: string;
  };
  data?: unknown;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function messageFrom(payload: NewApiEnvelope | null, fallback: string): string {
  return typeof payload?.message === "string"
    ? payload.message
    : typeof payload?.msg === "string"
      ? payload.msg
      : typeof payload?.error?.message === "string"
        ? payload.error.message
      : fallback;
}

function codeFrom(payload: NewApiEnvelope | null): string | number | undefined {
  if (typeof payload?.code === "string" || typeof payload?.code === "number") {
    return payload.code;
  }
  return typeof payload?.error?.code === "string" || typeof payload?.error?.code === "number"
    ? payload.error.code
    : undefined;
}

function isBusinessFailure(payload: NewApiEnvelope | null): boolean {
  return payload?.success === false || payload?.code === false;
}

export function createNewApiClient(options: NewApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetchImpl(joinUrl(options.baseUrl, path), { ...init, headers });
    } catch {
      throw new NewApiError("new-api 不可达", 503);
    }

    const payload = (await response.json().catch(() => null)) as NewApiEnvelope | null;
    if (!response.ok || isBusinessFailure(payload)) {
      throw new NewApiError(
        messageFrom(payload, `new-api 请求失败: ${response.status}`),
        response.status,
        codeFrom(payload),
        payload,
      );
    }
    return payload as T;
  }

  return {
    async login(input: NewApiLoginInput): Promise<NewApiLoginResult> {
      const response = await request<NewApiEnvelope>("/api/user/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const data = (response.data ?? {}) as { token?: unknown; id?: unknown; username?: unknown };
      const token = data.token;
      if (typeof token !== "string" || !token.startsWith("sk-")) {
        throw new NewApiError("new-api 登录未返回 sk-xxx token", 502, "invalid_token_response", response);
      }
      return {
        token,
        userId: typeof data.id === "number" ? data.id : typeof data.id === "string" ? Number(data.id) : null,
        username: typeof data.username === "string" ? data.username : null,
      };
    },

    async getTokenUsage(token: string): Promise<NewApiUsage> {
      const response = await request<NewApiEnvelope>("/api/usage/token/", { method: "GET" }, token);
      const data = (response.data ?? {}) as Record<string, unknown>;
      const quota = data.user_quota ?? data.quota ?? data.total_available;
      if (typeof quota !== "number" || !Number.isFinite(quota)) {
        throw new NewApiError("new-api usage 响应缺少 quota", 502, "invalid_usage_response", response);
      }
      return { userQuota: quota, raw: response.data };
    },

    async getTokenLogs(token: string): Promise<NewApiLog[]> {
      const response = await request<NewApiEnvelope>("/api/log/token", { method: "GET" }, token);
      return Array.isArray(response.data) ? (response.data as NewApiLog[]) : [];
    },

    async generateImages(token: string, input: NewApiImageInput): Promise<NewApiImage[]> {
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        response_format: "url",
        stream: false,
      };
      if (input.size) body.size = input.size;
      body.n = input.n;
      if (input.webSearch) body.tools = [{ type: "web_search" }];

      const response = await request<NewApiEnvelope>("/v1/images/generations", {
        method: "POST",
        body: JSON.stringify(body),
      }, token);
      const data = Array.isArray(response.data) ? response.data : [];
      return data.filter((item): item is NewApiImage => {
        return typeof item === "object" && item !== null && typeof (item as { url?: unknown }).url === "string";
      });
    },

    async editImages(token: string, input: NewApiImageEditInput): Promise<NewApiImage[]> {
      const body = new FormData();
      body.append("model", input.model);
      body.append("prompt", input.prompt);
      body.append("image", input.image, input.fileName);
      body.append("n", String(input.n));
      body.append("response_format", "url");
      if (input.size) body.append("size", input.size);

      const response = await request<NewApiEnvelope>("/v1/images/edits", {
        method: "POST",
        body,
      }, token);
      const data = Array.isArray(response.data) ? response.data : [];
      return data.filter((item): item is NewApiImage => {
        return typeof item === "object" && item !== null && typeof (item as { url?: unknown }).url === "string";
      });
    },

    async submitVideo(token: string, input: NewApiVideoInput): Promise<NewApiVideoSubmission> {
      const explicitImages = [input.firstFrameImage, ...(input.referenceImages ?? [])].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (
        input.lastFrameImage ||
        explicitImages.length > 1 ||
        (input.image && explicitImages.length > 0)
      ) {
        throw new NewApiError(
          "当前 new-api 视频接口不支持首尾帧或多参考素材",
          422,
          "unsupported_video_inputs",
        );
      }
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        duration: input.duration,
        width: input.width,
        height: input.height,
        response_format: input.responseFormat ?? "url",
      };
      const image = explicitImages[0] ?? input.image;
      if (image) body.image = image;

      const response = await request<Record<string, unknown>>("/v1/video/generations", {
        method: "POST",
        body: JSON.stringify(body),
      }, token);
      const data = response.data && typeof response.data === "object"
        ? response.data as Record<string, unknown>
        : response;
      const taskId = data.task_id ?? data.id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new NewApiError("new-api 视频提交响应缺少 task_id", 502, "invalid_video_response", response);
      }
      return {
        taskId,
        status: typeof data.status === "string" ? data.status : "queued",
      };
    },

    async getVideoTask(token: string, taskId: string): Promise<NewApiVideoTask> {
      const response = await request<Record<string, unknown>>(
        `/v1/video/generations/${encodeURIComponent(taskId)}`,
        { method: "GET" },
        token,
      );
      const data = response.data && typeof response.data === "object"
        ? response.data as Record<string, unknown>
        : response;
      const responseTaskId = data.task_id ?? data.id;
      if (typeof responseTaskId !== "string" || typeof data.status !== "string") {
        throw new NewApiError("new-api 视频任务响应无效", 502, "invalid_video_response", response);
      }
      const rawError = data.error;
      const error = rawError && typeof rawError === "object"
        ? {
            code:
              typeof (rawError as Record<string, unknown>).code === "string" ||
              typeof (rawError as Record<string, unknown>).code === "number"
                ? (rawError as Record<string, unknown>).code as string | number
                : null,
            message:
              typeof (rawError as Record<string, unknown>).message === "string"
                ? (rawError as Record<string, unknown>).message as string
                : "视频生成失败",
          }
        : null;
      return {
        taskId: responseTaskId,
        status: data.status,
        url:
          typeof data.url === "string"
            ? data.url
            : typeof data.result_url === "string"
              ? data.result_url
              : null,
        error,
      };
    },
  };
}
