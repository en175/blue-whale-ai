import { openAiError } from "@/lib/text/completions";

export async function POST(request: Request) {
  const serviceToken = process.env.AGENT_SERVICE_TOKEN;
  const baseUrl = process.env.NEW_API_BASE_URL?.replace(/\/+$/, "");
  if (!serviceToken || !baseUrl) return openAiError(503, "内部模型网关未配置", "config_missing");
  if (request.headers.get("x-agent-service-token") !== serviceToken) {
    return openAiError(401, "Agent 服务身份无效", "invalid_service_identity");
  }
  const capability = /^Bearer (bwcap_\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!capability) return openAiError(401, "Run Capability 无效", "invalid_capability");
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${capability}`,
        "content-type": "application/json",
        "x-trace-id": request.headers.get("x-trace-id") ?? crypto.randomUUID(),
      },
      body: await request.text(),
      signal: request.signal,
    });
  } catch {
    return openAiError(502, "NewAPI 不可达", "upstream_unavailable");
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "x-request-id": upstream.headers.get("x-request-id") ?? "",
    },
  });
}
