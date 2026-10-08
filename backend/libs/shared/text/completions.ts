import type { ModelCapabilityRepo } from "@lib/shared/persistence/index.js";
import { newApiBaseUrl, newApiFetch } from "@lib/shared/upstream/new-api-egress.js";


export interface TextCompletionsConfig {
  baseUrl: string;
}

export const TEXT_UPSTREAM_TIMEOUT_MS = 60_000;
export const TEXT_MAX_BODY_BYTES = 1_000_000;

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
