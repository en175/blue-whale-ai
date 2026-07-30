/** 火山方舟（Ark）图片生成客户端。
 *  对齐 Java VolcEngineImageGenerationProvider：POST {base}/api/v3/images/generations，
 *  Bearer {ARK_API_KEY}。MVP 用 response_format=url 直接拿临时 URL（TOS 永久化后续补）。 */

export interface ArkImageConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ArkImageRequest {
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  webSearch?: boolean;
  sequential?: boolean;
}

export interface ArkImageResult {
  urls: string[];
}

export class ArkImageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ArkImageError";
  }
}

/** 调 Ark 图片生成。失败抛 ArkImageError(code, message)，由 worker 转 job failed。 */
export async function generateImages(
  config: ArkImageConfig,
  req: ArkImageRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ArkImageResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    response_format: "url",
    stream: false,
  };
  if (req.size) body.size = req.size;
  if (req.n && req.n > 1) body.n = req.n;
  if (req.webSearch) body.tools = [{ type: "web_search" }];
  if (req.sequential) {
    body.sequential_image_generation = "auto";
    body.sequential_image_generation_options = { max_images: req.n ?? 1 };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ArkImageError("provider_failed", "生成服务不可达");
  }

  if (!res.ok) {
    throw new ArkImageError("provider_failed", `生成服务返回 ${res.status}`);
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: Array<{ url?: string; b64_json?: string }> }
    | null;
  const items = json?.data ?? [];
  const urls = items
    .map((d) => d.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  if (urls.length === 0) {
    throw new ArkImageError("no_result", "生成服务未返回结果");
  }
  return { urls };
}

export function loadArkImageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ArkImageConfig | null {
  const baseUrl = env.VOLC_ARK_BASE_URL;
  const apiKey = env.VOLC_ARK_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}
