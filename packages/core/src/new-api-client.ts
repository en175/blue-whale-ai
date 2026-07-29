export interface NewApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface NewApiLoginInput {
  username: string;
  password: string;
}

export interface NewApiRegisterInput {
  username: string;
  password: string;
  email?: string;
  verificationCode?: string;
}

export interface NewApiLoginResult {
  token: string;
  userId: number | null;
  username: string | null;
  email?: string | null;
}

export interface NewApiAccountCapabilities {
  passwordLogin: boolean;
  passwordRegister: boolean;
  emailVerification: boolean;
}

export interface NewApiAccountIdentity {
  userId: number;
  username: string;
  email: string | null;
  status: number;
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
  sequential?: boolean;
}

export interface NewApiImage {
  url: string;
  [key: string]: unknown;
}

export interface NewApiImageEditInput {
  model: string;
  prompt: string;
  /** Legacy single-image shape. Prefer images for new callers. */
  image?: Blob;
  fileName?: string;
  images?: Array<{ blob: Blob; fileName: string }>;
  size?: string | null;
  n: number;
  webSearch?: boolean;
  sequential?: boolean;
}

export type NewApiVideoReference = {
  type: "image" | "video";
  url: string;
};

export interface NewApiVideoInput {
  model: string;
  prompt: string;
  /** @deprecated Use references. Kept for the legacy worker adapter. */
  image?: string;
  firstFrameImage?: string;
  lastFrameImage?: string;
  /** @deprecated Use references. Kept for the legacy worker adapter. */
  referenceImages?: string[];
  references?: NewApiVideoReference[];
  duration: number;
  width: number;
  height: number;
  resolution: string;
  ratio: string;
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

function positiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createNewApiClient(options: NewApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function request<T>(
    path: string,
    init: RequestInit = {},
    token?: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    let payload: NewApiEnvelope | null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    if (init.signal?.aborted) {
      controller.abort();
    } else {
      init.signal?.addEventListener("abort", forwardAbort, { once: true });
    }
    try {
      response = await fetchImpl(joinUrl(options.baseUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      });
      try {
        payload = (await response.json()) as NewApiEnvelope;
      } catch {
        if (controller.signal.aborted) {
          throw new NewApiError("new-api 不可达", 503);
        }
        payload = null;
      }
    } catch (error) {
      if (error instanceof NewApiError) throw error;
      throw new NewApiError("new-api 不可达", 503);
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", forwardAbort);
    }

    if (payload === null) {
      throw new NewApiError(
        "new-api 响应不是有效 JSON",
        502,
        "invalid_json_response",
      );
    }
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
    async getAccountCapabilities(): Promise<NewApiAccountCapabilities> {
      const response = await request<NewApiEnvelope>("/api/status", {
        method: "GET",
      });
      const data = (response.data ?? {}) as Record<string, unknown>;
      return {
        passwordLogin: data.password_login_enabled === true,
        passwordRegister:
          data.register_enabled === true &&
          data.password_register_enabled === true,
        emailVerification: data.email_verification === true,
      };
    },

    async register(input: NewApiRegisterInput): Promise<NewApiLoginResult> {
      const response = await request<NewApiEnvelope>("/api/user/register", {
        method: "POST",
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          ...(input.email ? { email: input.email } : {}),
          ...(input.verificationCode
            ? { verification_code: input.verificationCode }
            : {}),
        }),
      });
      const data = (response.data ?? {}) as Record<string, unknown>;
      const userId = positiveInteger(data.user_id);
      if (
        userId === null ||
        typeof data.token !== "string" ||
        !data.token.startsWith("sk-") ||
        typeof data.username !== "string"
      ) {
        throw new NewApiError(
          "new-api 注册响应无效",
          502,
          "invalid_register_response",
          response,
        );
      }
      return {
        token: data.token,
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
      };
    },

    async resolveTokenIdentity(token: string): Promise<NewApiAccountIdentity> {
      const response = await request<NewApiEnvelope>(
        "/api/token/identity",
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Record<string, unknown>;
      const userId = positiveInteger(data.user_id);
      if (
        userId === null ||
        typeof data.username !== "string" ||
        typeof data.status !== "number"
      ) {
        throw new NewApiError(
          "new-api 身份响应无效",
          502,
          "invalid_identity_response",
          response,
        );
      }
      return {
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
        status: data.status,
      };
    },

    async login(input: NewApiLoginInput): Promise<NewApiLoginResult> {
      const response = await request<NewApiEnvelope>("/api/user/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const data = (response.data ?? {}) as {
        token?: unknown;
        id?: unknown;
        user_id?: unknown;
        username?: unknown;
        email?: unknown;
      };
      const token = data.token;
      const userId = positiveInteger(data.user_id ?? data.id);
      if (
        typeof token !== "string" ||
        !token.startsWith("sk-") ||
        userId === null ||
        typeof data.username !== "string"
      ) {
        throw new NewApiError(
          "new-api 登录响应无效",
          502,
          "invalid_login_response",
          response,
        );
      }
      return {
        token,
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
      };
    },

    async getTokenUsage(token: string): Promise<NewApiUsage> {
      const response = await request<NewApiEnvelope>(
        "/api/usage/token/",
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Record<string, unknown>;
      const quota = data.user_quota ?? data.quota ?? data.total_available;
      if (typeof quota !== "number" || !Number.isFinite(quota)) {
        throw new NewApiError(
          "new-api usage 响应缺少 quota",
          502,
          "invalid_usage_response",
          response,
        );
      }
      return { userQuota: quota, raw: response.data };
    },

    async getTokenLogs(token: string): Promise<NewApiLog[]> {
      const response = await request<NewApiEnvelope>(
        "/api/log/token",
        { method: "GET" },
        token,
      );
      return Array.isArray(response.data) ? (response.data as NewApiLog[]) : [];
    },

    async generateImages(
      token: string,
      input: NewApiImageInput,
    ): Promise<NewApiImage[]> {
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        response_format: "url",
        stream: false,
      };
      if (input.size) body.size = input.size;
      body.n = input.n;
      if (input.webSearch) body.tools = [{ type: "web_search" }];
      if (input.sequential) {
        body.sequential_image_generation = "auto";
        body.sequential_image_generation_options = { max_images: input.n };
      }

      const response = await request<NewApiEnvelope>(
        "/v1/images/generations",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      const data = Array.isArray(response.data) ? response.data : [];
      return data.filter((item): item is NewApiImage => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as { url?: unknown }).url === "string"
        );
      });
    },

    async editImages(
      token: string,
      input: NewApiImageEditInput,
    ): Promise<NewApiImage[]> {
      const body = new FormData();
      body.append("model", input.model);
      body.append("prompt", input.prompt);
      const images =
        input.images ??
        (input.image && input.fileName
          ? [{ blob: input.image, fileName: input.fileName }]
          : []);
      if (images.length === 0) {
        throw new NewApiError("图片编辑至少需要一张参考图", 400, "invalid_input");
      }
      const imageField = images.length === 1 ? "image" : "image[]";
      for (const image of images) {
        body.append(imageField, image.blob, image.fileName);
      }
      body.append("n", String(input.n));
      body.append("response_format", "url");
      if (input.size) body.append("size", input.size);
      if (input.webSearch) {
        body.append("tools", JSON.stringify([{ type: "web_search" }]));
      }
      if (input.sequential) {
        body.append("sequential_image_generation", "auto");
        body.append(
          "sequential_image_generation_options",
          JSON.stringify({ max_images: input.n }),
        );
      }

      const response = await request<NewApiEnvelope>(
        "/v1/images/edits",
        {
          method: "POST",
          body,
        },
        token,
      );
      const data = Array.isArray(response.data) ? response.data : [];
      return data.filter((item): item is NewApiImage => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as { url?: unknown }).url === "string"
        );
      });
    },

    async submitVideo(token: string, input: NewApiVideoInput): Promise<NewApiVideoSubmission> {
      const references = input.references ?? [
        ...(input.image ? [{ type: "image" as const, url: input.image }] : []),
        ...(input.referenceImages ?? []).map((url) => ({
          type: "image" as const,
          url,
        })),
      ];
      const hasFrames = Boolean(input.firstFrameImage || input.lastFrameImage);
      if (
        (input.lastFrameImage && !input.firstFrameImage) ||
        (hasFrames && references.length > 0)
      ) {
        throw new NewApiError(
          "首尾帧模式不能与普通参考素材混用",
          422,
          "unsupported_video_inputs",
        );
      }
      const content: Array<Record<string, unknown>> = [];
      if (input.firstFrameImage) {
        content.push({
          type: "image_url",
          image_url: { url: input.firstFrameImage },
          role: "first_frame",
        });
      }
      if (input.lastFrameImage) {
        content.push({
          type: "image_url",
          image_url: { url: input.lastFrameImage },
          role: "last_frame",
        });
      }
      for (const reference of references) {
        content.push(
          reference.type === "image"
            ? {
                type: "image_url",
                image_url: { url: reference.url },
                role: "reference_image",
              }
            : {
                type: "video_url",
                video_url: { url: reference.url },
                role: "reference_video",
              },
        );
      }
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        duration: input.duration,
        response_format: input.responseFormat ?? "url",
        metadata: {
          duration: input.duration,
          resolution: input.resolution,
          ratio: input.ratio,
          content,
        },
      };

      const response = await request<Record<string, unknown>>(
        "/v1/video/generations",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      const data =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : response;
      const taskId = data.task_id ?? data.id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new NewApiError(
          "new-api 视频提交响应缺少 task_id",
          502,
          "invalid_video_response",
          response,
        );
      }
      return {
        taskId,
        status: typeof data.status === "string" ? data.status : "queued",
      };
    },

    async getVideoTask(
      token: string,
      taskId: string,
    ): Promise<NewApiVideoTask> {
      const response = await request<Record<string, unknown>>(
        `/v1/video/generations/${encodeURIComponent(taskId)}`,
        { method: "GET" },
        token,
      );
      const data =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : response;
      const responseTaskId = data.task_id ?? data.id;
      if (
        typeof responseTaskId !== "string" ||
        typeof data.status !== "string"
      ) {
        throw new NewApiError(
          "new-api 视频任务响应无效",
          502,
          "invalid_video_response",
          response,
        );
      }
      const rawError = data.error;
      const error =
        rawError && typeof rawError === "object"
          ? {
              code:
                typeof (rawError as Record<string, unknown>).code ===
                  "string" ||
                typeof (rawError as Record<string, unknown>).code === "number"
                  ? ((rawError as Record<string, unknown>).code as
                      string | number)
                  : null,
              message:
                typeof (rawError as Record<string, unknown>).message ===
                "string"
                  ? ((rawError as Record<string, unknown>).message as string)
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
