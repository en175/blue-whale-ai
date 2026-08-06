import {
  createModelCapabilityRepo,
  getPrismaClient,
} from "@blue-whale/persistence";
import type { ModelCapabilityRepo } from "@blue-whale/persistence";

/** 文生文接口（IK6ZEH）：OpenAI 兼容薄代理。
 *  BFF 只做登录鉴权 + text 白名单闸，body 全透传 Go /v1/chat/completions。
 *  白名单源 = generation_model_capability 的启用 text 行（listEnabledByType("text")），
 *  model 必须命中否则 400。语义校验全部下放 Go，不替 LLM 做判断。 */

export interface TextCompletionsConfig {
  baseUrl: string;
}

/** 只读 NEW_API_BASE_URL（与充值/文生图共用同一 Go new-api 服务）；缺失 → null（调用方按未配置返回 503）。 */
export function loadTextCompletionsConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TextCompletionsConfig | null {
  const baseUrl = env.NEW_API_BASE_URL;
  return baseUrl ? { baseUrl } : null;
}

export type ResolveTextModelResult =
  { ok: true } | { ok: false; status: number; message: string; code: string };

export interface TextCompletionsDeps {
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
}

export function createTextCompletionsDeps(): TextCompletionsDeps {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return { models: createModelCapabilityRepo(getPrismaClient(databaseUrl)) };
}

/** 薄代理白名单闸：model 必须命中启用 text 模型；参数只拦硬错误（非字符串/非数组），其余交给 Go。 */
export async function resolveTextModel(
  model: unknown,
  messages: unknown,
  deps: TextCompletionsDeps,
): Promise<ResolveTextModelResult> {
  if (typeof model !== "string" || model.trim() === "") {
    return {
      ok: false,
      status: 400,
      message: "model 无效",
      code: "invalid_model",
    };
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
): Response {
  const type =
    status === 401
      ? "authentication_error"
      : status === 402
        ? "insufficient_quota"
        : status >= 500
          ? "server_error"
          : "invalid_request_error";
  return Response.json({ error: { message, type, code } }, { status });
}
