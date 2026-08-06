import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import {
  createTextCompletionsDeps,
  loadTextCompletionsConfig,
  openAiError,
  resolveTextModel,
} from "@/lib/text/completions";

// POST /api/text/completions —— OpenAI 兼容文生文薄代理（IK6ZEH）。
// 鉴权 + text 白名单闸，body 全透传 Go new-api /v1/chat/completions；stream=true 时 raw SSE 透传。
export async function POST(request: Request) {
  const config = loadTextCompletionsConfig();
  if (!config) {
    return openAiError(503, "文本生成服务未配置", "config_missing");
  }

  return withAuthenticatedUser(request, async () => {
    const token = parseNewApiBearerToken(request.headers.get("authorization"));
    if (!token) {
      return openAiError(401, "缺少有效的 sk- 令牌", "invalid_token");
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return openAiError(400, "请求体必须是合法 JSON", "invalid_json");
    }

    const gate = await resolveTextModel(
      body.model,
      body.messages,
      createTextCompletionsDeps(),
    );
    if (!gate.ok) {
      return openAiError(gate.status, gate.message, gate.code);
    }

    const upstream = await fetch(`${config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json",
      },
    });
  });
}
