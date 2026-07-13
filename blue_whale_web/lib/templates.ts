import type { ApiResult, TemplatePage, TemplateTag } from "@/types/template";

const API_URL = process.env.NEXT_PUBLIC_TEMPLATE_API_URL ?? "/api/agent/templates";
const FETCH_TIMEOUT = 8000;

export class TemplateApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "TemplateApiError";
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析后端统一 Result 结构，仅当 code === 200 时返回 data。
 */
async function getResult<T>(url: string): Promise<T> {
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT);
  if (!res.ok) {
    throw new TemplateApiError(`请求失败: ${res.status} ${res.statusText}`, res.status);
  }
  const result = (await res.json()) as ApiResult<T>;
  if (!result || result.code !== 200) {
    throw new TemplateApiError(result?.msg ?? "接口返回失败", result?.code);
  }
  return result.data;
}

/** 标签列表（仅元数据） */
export function fetchTemplateTags(): Promise<TemplateTag[]> {
  return getResult<TemplateTag[]>(`${API_URL}/tags`);
}

/** 按标签分页查询卡片 */
export function fetchTemplatePage(tagCode: string, page = 1, size = 50): Promise<TemplatePage> {
  const qs = new URLSearchParams({
    tagCode,
    page: String(page),
    size: String(size),
  });
  return getResult<TemplatePage>(`${API_URL}/page?${qs.toString()}`);
}
