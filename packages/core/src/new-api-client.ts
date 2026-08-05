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
  role: number;
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

export interface NewApiRechargeTierItem {
  id: string;
  name: string;
  amount: number;
  price: number;
  original_price?: number | null;
  bonus: number;
  is_recommended: boolean;
  sort_order: number;
}

export interface NewApiRechargeTiersResult {
  tiers: NewApiRechargeTierItem[];
}

export interface NewApiRechargeOrderResult {
  trade_no: string;
  qr_code_data: string;
  expire_time: number;
  amount: number;
  points: number;
}

export interface NewApiRechargeOrderStatus {
  trade_no: string;
  status: string;
  credits_after?: number | null;
}

export interface NewApiRechargeAgreement {
  title: string;
  content: string;
}

// ---- 原生充值（Model B：catalog→web，settlement→Go 原生 new-api topup）----

/** 原生 BlueWhalePay 下单结果。pay_data 与旧自定义 recharge 的 qr_code_data 同源
 *  （都来自 BlueWhalePay 统一下单），前端直接当二维码渲染。 */
export interface NewApiTopUpOrderResult {
  /** Go TopUp.trade_no（BWP... 前缀） */
  tradeNo: string;
  /** 支付拉起数据 / 二维码 */
  payData: string;
}

/** 原生充值订单记录（GET /api/user/topup/self 的 items 元素）。 */
export interface NewApiTopUpRecord {
  trade_no: string;
  /** pending | success | failed | expired（Go common.TopUpStatus*） */
  status: string;
  /** 美元额度 N（加 quota = N × QuotaPerUnit） */
  amount: number;
  /** 实付金额（元，getPayMoney 算） */
  money: number;
  create_time: number;
  complete_time: number;
}

// ---- 管理端（middleware.AdminAuth：仅 role >= 10 的管理员 token 可调）----
// 接口：GET /api/user、/api/user/search、POST /api/user/manage、
//       GET /api/user/topup、POST /api/user/topup/complete、
//       GET /api/log/stat、GET /api/log。信封为标准 {success, data} 分页（PageInfo）。

/** new-api 通用分页信封（PageInfo：page / page_size / total / items）。 */
export interface NewApiPageInfo<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** GET /api/user、/api/user/search 的行元素（model.User 的 json 视图）。 */
export interface NewApiAdminUserRow {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  role: number;
  status: number;
  quota: number;
  used_quota: number;
  created_at: number;
  [key: string]: unknown;
}

/** GET /api/user/topup 的行元素（model.TopUp 的 json 视图）。 */
export interface NewApiAdminTopUpRow {
  id: number;
  user_id: number;
  amount: number;
  money: number;
  trade_no: string;
  payment_method: string;
  payment_provider: string;
  create_time: number;
  complete_time: number;
  /** pending | success | failed | expired */
  status: string;
  [key: string]: unknown;
}

/** GET /api/log 的行元素（model.Log 的 json 视图，管理员侧全部用户）。 */
export interface NewApiLogRow {
  id: number;
  user_id: number;
  created_at: number;
  type: number;
  username: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  [key: string]: unknown;
}

/** GET /api/log/stat 的聚合结果。 */
export interface NewApiLogStat {
  quota: number;
  rpm: number;
  tpm: number;
}

/** POST /api/user/manage 入参（Go ManageRequest）。 */
export interface NewApiAdminManageUserInput {
  id: number;
  action: "disable" | "enable" | "add_quota";
  value?: number;
  mode?: "add" | "subtract" | "override";
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

/** 归一化 new-api 分页信封（PageInfo），缺字段兜底，防脏数据抛错。 */
function normalizePage<T>(
  data: unknown,
  pageSize: number,
): NewApiPageInfo<T> {
  const page = (data ?? {}) as Partial<NewApiPageInfo<T>>;
  return {
    items: Array.isArray(page.items) ? page.items : [],
    total: typeof page.total === "number" ? page.total : 0,
    page: typeof page.page === "number" ? page.page : 1,
    page_size: typeof page.page_size === "number" ? page.page_size : pageSize,
  };
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

/**
 * 原生充值接口（/api/user/amount、/api/user/bluewhalepay/pay、
 * /api/user/topup/self）挂在账户层 AccountTokenOrUserAuth 下，只凭 Bearer
 * sk-xxx 证明账户身份；订单 User ID 由 Go 从 Token 属主解析，客户端不得
 * 发送 New-Api-User 头。（RootAuth 的 /api/option/ 管理接口仍需该头，见下方。）
 */
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
      const role =
        typeof data.role === "number" && Number.isInteger(data.role)
          ? data.role
          : 1;
      return {
        userId,
        username: data.username,
        email: typeof data.email === "string" ? data.email : null,
        status: data.status,
        role,
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

    // ---- recharge ----

    async getRechargeTiers(): Promise<NewApiRechargeTiersResult> {
      const response = await request<NewApiEnvelope>("/api/recharge/tiers", { method: "GET" });
      const data = (response.data ?? {}) as NewApiRechargeTiersResult;
      if (!Array.isArray(data.tiers)) {
        throw new NewApiError("new-api recharge tiers 响应缺少 tiers", 502, "invalid_tiers_response", response);
      }
      return data;
    },

    async createRechargeOrder(token: string, tierId: string, paymentMethod: string): Promise<NewApiRechargeOrderResult> {
      const response = await request<NewApiEnvelope>("/api/recharge/order", {
        method: "POST",
        body: JSON.stringify({ tier_id: tierId, payment_method: paymentMethod }),
      }, token);
      const data = (response.data ?? {}) as NewApiRechargeOrderResult;
      if (typeof data.trade_no !== "string" || typeof data.qr_code_data !== "string") {
        throw new NewApiError("new-api recharge order 响应无效", 502, "invalid_order_response", response);
      }
      return data;
    },

    async getRechargeOrderStatus(token: string, tradeNo: string): Promise<NewApiRechargeOrderStatus> {
      const response = await request<NewApiEnvelope>(
        `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as NewApiRechargeOrderStatus;
      if (typeof data.trade_no !== "string" || typeof data.status !== "string") {
        throw new NewApiError("new-api recharge order status 响应无效", 502, "invalid_status_response", response);
      }
      return data;
    },

    async cancelRechargeOrder(token: string, tradeNo: string): Promise<void> {
      await request<NewApiEnvelope>(
        `/api/recharge/order/${encodeURIComponent(tradeNo)}/cancel`,
        { method: "POST" },
        token,
      );
    },

    async getRechargeAgreement(): Promise<NewApiRechargeAgreement> {
      const response = await request<NewApiEnvelope>("/api/recharge/agreement", { method: "GET" });
      const data = (response.data ?? {}) as NewApiRechargeAgreement;
      if (typeof data.title !== "string") {
        throw new NewApiError("new-api recharge agreement 响应无效", 502, "invalid_agreement_response", response);
      }
      return data;
    },

    // ---- native topup（复用 Go 原生 new-api 充值；web 只管档位目录，结算走这里）----

    /** 原生充值报价：POST /api/user/amount → 实付金额（元，Go getPayMoney 算）。
     *  该端点信封是 {message:"success"/"error", data}（无 success 布尔、HTTP 恒 200），
     *  通用 request() 的 isBusinessFailure 抓不到错误，这里显式判 message==="error"。 */
    async requestTopUpAmount(
      token: string,
      amount: number,
    ): Promise<number> {
      const response = await request<NewApiEnvelope>(
        "/api/user/amount",
        {
          method: "POST",
          body: JSON.stringify({ amount }),
        },
        token,
      );
      if (response.message === "error") {
        throw new NewApiError(
          typeof response.data === "string" ? response.data : "充值报价失败",
          400,
          "topup_amount_error",
          response,
        );
      }
      const money = typeof response.data === "string" ? Number(response.data) : Number.NaN;
      if (!Number.isFinite(money)) {
        throw new NewApiError(
          "new-api 充值报价响应无效",
          502,
          "invalid_topup_amount_response",
          response,
        );
      }
      return money;
    },

    /** 原生 BlueWhalePay 下单：POST /api/user/bluewhalepay/pay。
     *  amount = 美元额度 N（CNY 显示模式直接用；加 quota = N × QuotaPerUnit）。
     *  wayCode：wechat→WX_NATIVE、alipay→ALI_QR；留空走 Go 默认 BlueWhalePayWayCode。
     *  信封同 /api/user/amount，显式判 message==="error"。 */
    async createBlueWhalePayTopUp(
      token: string,
      amount: number,
      wayCode?: string,
    ): Promise<NewApiTopUpOrderResult> {
      const body: Record<string, unknown> = { amount };
      if (wayCode) body.way_code = wayCode;
      const response = await request<NewApiEnvelope>(
        "/api/user/bluewhalepay/pay",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      if (response.message === "error") {
        throw new NewApiError(
          typeof response.data === "string" ? response.data : "拉起支付失败",
          400,
          "topup_order_error",
          response,
        );
      }
      const data = (response.data ?? {}) as { pay_data?: unknown; order_id?: unknown };
      if (typeof data.pay_data !== "string" || typeof data.order_id !== "string") {
        throw new NewApiError(
          "new-api bluewhalepay 下单响应无效",
          502,
          "invalid_topup_order_response",
          response,
        );
      }
      return { tradeNo: data.order_id, payData: data.pay_data };
    },

    /** 按单号查原生充值订单：GET /api/user/topup/self?keyword=<tradeNo>，取精确匹配项。
     *  未找到（或非当前用户订单）返回 null。状态枚举 pending/success/failed/expired。 */
    async getTopUpByTradeNo(
      token: string,
      tradeNo: string,
    ): Promise<NewApiTopUpRecord | null> {
      const response = await request<NewApiEnvelope>(
        `/api/user/topup/self?keyword=${encodeURIComponent(tradeNo)}`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as { items?: unknown };
      const items = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      const match = items.find((item) => item.trade_no === tradeNo);
      if (!match) return null;
      return {
        trade_no: String(match.trade_no),
        status: typeof match.status === "string" ? match.status : "",
        amount: Number(match.amount ?? 0),
        money: Number(match.money ?? 0),
        create_time: Number(match.create_time ?? 0),
        complete_time: Number(match.complete_time ?? 0),
      };
    },

    // ---- Go 管理端 option（RootAuth）----
    // PUT/GET /api/option/ 走 middleware.RootAuth：需 root 用户的 access_token（Authorization）
    // + New-Api-User 头（= 令牌属主的数字 id，authHelper 校验 id == apiUserId）。
    // 用于 web 维护 Go 全局 payment_setting.amount_discount（逐档充值折扣）。
    // 信封是标准 {success,...}，通用 request() 的 isBusinessFailure 可判错（不同于 topup 的 {message} 壳）。

    /** 读单个 option 的原始字符串值；不存在返回 null。 */
    async getRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
    ): Promise<string | null> {
      const response = await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "GET",
          headers: { "New-Api-User": String(rootUserId) },
        },
        rootToken,
      );
      const items = Array.isArray(response.data)
        ? (response.data as Array<{ key?: unknown; value?: unknown }>)
        : [];
      const found = items.find((item) => item.key === key);
      if (!found || found.value == null) return null;
      return typeof found.value === "string" ? found.value : String(found.value);
    },

    /** 写单个 option。value 必须已是 JSON 字符串——Go UpdateOption 对 object 值会
     *  `fmt.Sprintf("%v")` 损坏，必须发字符串（Go 前端即如此）。 */
    async putRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
      value: string,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "PUT",
          headers: { "New-Api-User": String(rootUserId) },
          body: JSON.stringify({ key, value }),
        },
        rootToken,
      );
    },

    // ---- 管理端（AdminAuth：role >= 10 的管理员 token，信封为标准分页 PageInfo）----

    /** 用户列表/搜索：有筛选条件走 /api/user/search，否则 /api/user。 */
    async listAdminUsers(
      token: string,
      options: {
        keyword?: string;
        status?: number;
        role?: number;
        page?: number;
        pageSize?: number;
      } = {},
    ): Promise<NewApiPageInfo<NewApiAdminUserRow>> {
      const params = new URLSearchParams();
      if (options.keyword) params.set("keyword", options.keyword);
      if (options.status != null) params.set("status", String(options.status));
      if (options.role != null) params.set("role", String(options.role));
      params.set("p", String(options.page ?? 1));
      params.set("page_size", String(options.pageSize ?? 20));
      const hasFilter =
        Boolean(options.keyword) ||
        options.status != null ||
        options.role != null;
      const path = hasFilter
        ? `/api/user/search?${params}`
        : `/api/user?${params}`;
      const response = await request<NewApiEnvelope>(
        path,
        { method: "GET" },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },

    /** 用户管理写操作（冻结 disable / 解冻 enable / 加减余额 add_quota）。 */
    async manageAdminUser(
      token: string,
      input: NewApiAdminManageUserInput,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/user/manage",
        { method: "POST", body: JSON.stringify(input) },
        token,
      );
    },

    /** 全平台充值记录（管理端），keyword 模糊匹配 trade_no。 */
    async listAdminTopUps(
      token: string,
      options: { keyword?: string; page?: number; pageSize?: number } = {},
    ): Promise<NewApiPageInfo<NewApiAdminTopUpRow>> {
      const params = new URLSearchParams();
      if (options.keyword) params.set("keyword", options.keyword);
      params.set("p", String(options.page ?? 1));
      params.set("page_size", String(options.pageSize ?? 20));
      const response = await request<NewApiEnvelope>(
        `/api/user/topup?${params}`,
        { method: "GET" },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },

    /** 管理员补单：把 pending 订单手工置为到账（Go ManualCompleteTopUp）。 */
    async completeAdminTopUp(token: string, tradeNo: string): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/user/topup/complete",
        { method: "POST", body: JSON.stringify({ trade_no: tradeNo }) },
        token,
      );
    },

    /** 日志聚合统计（GetLogsStat）：type=2 为消费；quota 单位与用户余额一致。 */
    async getAdminLogStat(
      token: string,
      input: { type: number; startTimestamp: number; endTimestamp: number },
    ): Promise<NewApiLogStat> {
      const params = new URLSearchParams({
        type: String(input.type),
        start_timestamp: String(input.startTimestamp),
        end_timestamp: String(input.endTimestamp),
      });
      const response = await request<NewApiEnvelope>(
        `/api/log/stat?${params}`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as Partial<NewApiLogStat>;
      return {
        quota: typeof data.quota === "number" ? data.quota : 0,
        rpm: typeof data.rpm === "number" ? data.rpm : 0,
        tpm: typeof data.tpm === "number" ? data.tpm : 0,
      };
    },

    /** 全平台使用日志（管理端，/api/log 分页，id 倒序）。 */
    async listAdminLogs(
      token: string,
      options: { page?: number; pageSize?: number } = {},
    ): Promise<NewApiPageInfo<NewApiLogRow>> {
      const params = new URLSearchParams({
        p: String(options.page ?? 1),
        page_size: String(options.pageSize ?? 20),
      });
      const response = await request<NewApiEnvelope>(
        `/api/log?${params}`,
        { method: "GET" },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },
  };
}
