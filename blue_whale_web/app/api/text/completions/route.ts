import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  TEXT_MAX_BODY_BYTES,
  TEXT_UPSTREAM_TIMEOUT_MS,
  createTextCompletionsDeps,
  loadTextCompletionsConfig,
  openAiError,
  resolveTextModel,
  type TextCompletionsDeps,
} from "@/lib/text/completions";

// POST /api/text/completions —— OpenAI 兼容文生文薄代理（IK6ZEH；加固 IK707U）。
// 鉴权 + text 白名单闸，body 全透传 Go new-api /v1/chat/completions；stream=true 时 raw SSE 透传。
export async function POST(request: Request) {
  const config = loadTextCompletionsConfig();
  if (!config) {
    return openAiError(503, "文本生成服务未配置", "config_missing");
  }

  return withAuthenticatedUser(request, async () => {
    const token = parseNewApiBearerToken(request.headers.get("authorization"));
    if (!token) {
      // M2：与 getAuthenticatedUser 内部的 bearer 解析是同一正则，handler 运行时 token 恒非空，
      // 此分支仅作类型收窄（string | null → string）。若未来换 withOptionalUser（游客放行），
      // 该分支会激活——届时 401 走 OpenAI shape 而非账户层 envelope，注意混合错误形状契约。
      return openAiError(401, "缺少有效的 sk- 令牌", "invalid_token");
    }

    // M4：content-length 超限直接拒绝（防鉴权用户推超大 payload）；chunked 无该头时跳过。
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > TEXT_MAX_BODY_BYTES) {
      return openAiError(413, "请求体过大（上限 1MB）", "payload_too_large");
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return openAiError(400, "请求体必须是合法 JSON", "invalid_json");
    }

    let deps: TextCompletionsDeps;
    try {
      deps = createTextCompletionsDeps();
    } catch {
      // M6：DATABASE_URL 缺失时保持 OpenAI shape，不裸抛 HTML 500。
      return openAiError(500, "文本模型白名单读取失败", "database_unavailable");
    }
    const gate = await resolveTextModel(body.model, body.messages, deps);
    if (!gate.ok) {
      return openAiError(gate.status, gate.message, gate.code);
    }

    // M3：非流请求防 Go 挂起拖死 BFF 连接；流式 SSE 长连接不加超时（不截断）。
    const isStream = body.stream === true;
    let upstream: Response;
    try {
      upstream = await fetch(`${config.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: isStream
          ? undefined
          : AbortSignal.timeout(TEXT_UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        return openAiError(504, "上游响应超时", "upstream_timeout");
      }
      return openAiError(502, "上游请求失败", "upstream_error");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  });
}
