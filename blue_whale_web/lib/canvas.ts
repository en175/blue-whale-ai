/**
 * canvas —— project / canvas 持久化请求层（照 lib/auth.ts 的 fetchWithTimeout + ApiResult 模式）。
 *
 * 走 Next `/api/projects`、`/api/canvases` 产品路由。
 * 浏览器只发送 Authorization；服务端路由通过 new-api 校验凭据并解析用户身份。
 */
import { loadAccessToken } from "@/components/auth/authStorage";
import { notifyAuthFailure } from "./api-client";
import type { WireInteger } from "./wire-integer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const FETCH_TIMEOUT = 10000;

/** 项目响应（列表/详情），对齐后端 ProjectDto。 */
export interface ProjectDto {
  id: WireInteger;
  name: string;
  thumb: string | null;
  created_at: string;
}

/** 画布响应（整体 GET），对齐后端 CanvasDto；viewport/nodes 为 JSON 字符串。 */
export interface CanvasDto {
  id: WireInteger | null;
  project_id: WireInteger;
  version?: number | null;
  viewport: string | null;
  nodes: string;
}

interface ApiResult<T> {
  code: number;
  msg: string;
  success: boolean;
  data: T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getResult<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}${url}`,
    options,
    FETCH_TIMEOUT,
  );
  if (!res.ok) {
    if (res.status === 401) {
      notifyAuthFailure();
    }
    throw new ApiError(`请求失败: ${res.status}`, res.status);
  }
  const result = (await res.json()) as ApiResult<T>;
  if (!result || result.code !== 200) {
    throw new ApiError(result?.msg ?? "接口返回失败", result?.code);
  }
  return result.data;
}

function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/** 建项目。 */
export function createProject(name: string): Promise<ProjectDto> {
  return getResult<ProjectDto>("/api/projects", {
    method: "POST",
    headers: authHeaders(loadAccessToken()),
    body: JSON.stringify({ name }),
  });
}

/** 项目列表（当前用户）。 */
export function listProjects(): Promise<ProjectDto[]> {
  return getResult<ProjectDto[]>("/api/projects", {
    headers: authHeaders(loadAccessToken()),
  });
}

/** 项目详情。 */
export function getProject(id: WireInteger): Promise<ProjectDto> {
  return getResult<ProjectDto>(`/api/projects/${id}`, {
    headers: authHeaders(loadAccessToken()),
  });
}

/** 重命名项目。 */
export function renameProject(
  id: WireInteger,
  name: string,
): Promise<ProjectDto> {
  return getResult<ProjectDto>(`/api/projects/${id}`, {
    method: "PUT",
    headers: authHeaders(loadAccessToken()),
    body: JSON.stringify({ name }),
  });
}

/** 删除项目。 */
export function deleteProject(id: WireInteger): Promise<void> {
  return getResult<void>(`/api/projects/${id}`, {
    method: "DELETE",
    headers: authHeaders(loadAccessToken()),
  });
}

/** 加载画布（按 projectId，无记录时 id 为 null）。 */
export function loadCanvas(projectId: WireInteger): Promise<CanvasDto> {
  return getResult<CanvasDto>(`/api/canvases?projectId=${projectId}`, {
    headers: authHeaders(loadAccessToken()),
  });
}

/**
 * 整体保存画布：viewport/nodes 由调用方 JSON.stringify 后传入字符串
 * （后端 SaveCanvasRequest 按透明字符串存，不解析结构，见 ADR-0011 D3）。
 */
export function saveCanvas(
  projectId: WireInteger,
  viewport: string,
  nodes: string,
  expectedVersion?: number | null,
): Promise<CanvasDto> {
  const headers = new Headers(authHeaders(loadAccessToken()));
  if (expectedVersion !== undefined) {
    headers.set(
      "If-Match",
      expectedVersion === null ? '"missing"' : `"${expectedVersion}"`,
    );
  }
  return getResult<CanvasDto>(`/api/canvases/${projectId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ viewport, nodes }),
  });
}
