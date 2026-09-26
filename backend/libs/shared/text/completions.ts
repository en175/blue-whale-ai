import type { ModelCapabilityRepo } from "@lib/shared/persistence/index.js";
import { newApiBaseUrl, newApiFetch } from "@lib/shared/upstream/new-api-egress.js";

/** 文生文接口（IK6ZEH）：OpenAI 兼容薄代理。
 *  后端只做登录鉴权 + text 白名单闸，body 全透传 Go /v1/chat/completions。
 *  白名单源 = generation_model_capability 的启用 text 行（listEnabledByType("text")）。
 *
 *  ⚠️ base URL **不在这里读**：new-api 只有一个出口（`@lib/shared/upstream/new-api-egress`）。
 *  这里曾经自己读一遍 `NEW_API_BASE_URL`，是那六处各读各的其中一处。 */

export interface TextCompletionsConfig {
  baseUrl: string;
}

/** 上游（Go new-api）非流请求超时：防 Go 挂起拖死连接；stream=true 不加超时（SSE 长连接）。 */
export const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;
/** 请求体最大字节数（content-length 校验）：防鉴权用户推超大 payload。 */
export const TEXT_MAX_BODY_BYTES = 1_000_000;

/**
 * 上游是否已配置。
 *
 * @returns 未配置时 null（调用方回 503，而不是崩）——保留这个容忍度是因为
 *          文生文是**可选能力**，不跑它的部署仍要能起来。
 *          ⚠️ 但地址本身从出口取，不在这里再读一遍环境变量。
 */
export function loadTextCompletionsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TextCompletionsConfig | null {
  try {
    return { baseUrl: newApiBaseUrl(env as NodeJS.ProcessEnv) };
  } catch {
    return null;
  }
}

export type ResolveTextModelResult =
  | { ok: true }
  | { ok: false; status: number; message: string; code: string };

export interface TextCompletionsDeps {
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
}

/** 薄代理白名单闸：model 必须命中启用 text 模型；参数只拦硬错误（非字符串/非数组），其余交给 Go。 */
export async function resolveTextModel(
  model: unknown,
  messages: unknown,
  deps: TextCompletionsDeps,
): Promise<ResolveTextModelResult> {
  if (typeof model !== "string" || model.trim() === "") {
    return { ok: false, status: 400, message: "model 无效", code: "invalid_model" };
  }
  if (!Array.isArray(messages)) {
    return {
      ok: false,
      status: 400,
      message: "messages 必须是数组",
      code: "invalid_messages",
    };
  }
  const whitelist = await deps.models.listEnabledByType("text");
  if (!whitelist.some((m) => m.model_id === model)) {
    return {
      ok: false,
      status: 400,
      message: "model 不在可用文本模型白名单或已停用",
      code: "model_not_in_whitelist",
    };
  }
  return { ok: true };
}

/** OpenAI 错误形状：{error:{message,type,code}}。薄代理契约要求业务错误也是 OpenAI 原样。 */
export function openAiError(
  status: number,
  message: string,
  code: string,
): { status: number; body: { error: { message: string; type: string; code: string } } } {
  const type =
    status === 401
      ? "authentication_error"
      : status === 402
        ? "insufficient_quota"
        : status >= 500
          ? "server_error"
          : "invalid_request_error";
  return { status, body: { error: { message, type, code } } };
}
