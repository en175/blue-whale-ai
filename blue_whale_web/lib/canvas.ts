/**
 * canvas —— project / canvas 持久化请求层（照 lib/auth.ts 的 fetchWithTimeout + ApiResult 模式）。
 *
 * 走 Next rewrite /api/agent/projects、/api/agent/canvases → agent-service（见 next.config.ts）。
 * 用户身份走 X-User-Id 头（网关注入 JWT 后转发，本地开发 loadAccessToken 走 Authorization
 * 由网关转 X-User-Id；此处不重复造轮子，直接带 Authorization，交给网关处理）。
 */
import { loadAccessToken, loadUser, SKIP_AUTH, MOCK_USER } from "@/components/auth/authStorage";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const FETCH_TIMEOUT = 10000;

/** 项目响应（列表/详情），对齐后端 ProjectDto。 */
export interface ProjectDto {
  id: number;
  name: string;
  thumb: string | null;
  created_at: string;
}

/** 画布响应（整体 GET），对齐后端 CanvasDto；viewport/nodes 为 JSON 字符串。 */
export interface CanvasDto {
  id: number | null;
  project_id: number;
  viewport: string;
  nodes: string;
}

interface ApiResult<T> {
  code: number;
  msg: string;
  success: boolean;
  data: T;
}

export class ApiError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getResult<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${url}`, options, FETCH_TIMEOUT);
  if (!res.ok) {
    throw new ApiError(`请求失败: ${res.status}`, res.status);
  }
  const result = (await res.json()) as ApiResult<T>;
  if (!result || result.code !== 200) {
    throw new ApiError(result?.msg ?? "接口返回失败", result?.code);
  }
  return result.data;
}

function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // 本地直连 agent-service（Next rewrite 无网关），后端 UserContext 读 X-User-Id；
  // 线上网关也注入同名头，本地补发确保直连可用。
  // SKIP_AUTH 下可能未真实登录（loadUser 为空），用 MOCK_USER.userId 兜底本地直连。
  const user = loadUser() ?? (SKIP_AUTH ? MOCK_USER : null);
  if (user) headers["X-User-Id"] = String(user.userId);
  return headers;
}

/** 建项目。 */
export function createProject(name: string): Promise<ProjectDto> {
  return getResult<ProjectDto>("/api/agent/projects", {
    method: "POST",
    headers: authHeaders(loadAccessToken()),
    body: JSON.stringify({ name }),
  });
}

/** 项目列表（当前用户）。 */
export function listProjects(): Promise<ProjectDto[]> {
  return getResult<ProjectDto[]>("/api/agent/projects", {
    headers: authHeaders(loadAccessToken()),
  });
}

/** 项目详情。 */
export function getProject(id: number): Promise<ProjectDto> {
  return getResult<ProjectDto>(`/api/agent/projects/${id}`, {
    headers: authHeaders(loadAccessToken()),
  });
}

/** 重命名项目。 */
export function renameProject(id: number, name: string): Promise<ProjectDto> {
  return getResult<ProjectDto>(`/api/agent/projects/${id}`, {
    method: "PUT",
    headers: authHeaders(loadAccessToken()),
    body: JSON.stringify({ name }),
  });
}

/** 删除项目。 */
export function deleteProject(id: number): Promise<void> {
  return getResult<void>(`/api/agent/projects/${id}`, {
    method: "DELETE",
    headers: authHeaders(loadAccessToken()),
  });
}

/** 加载画布（按 projectId，无记录时 id 为 null）。 */
export function loadCanvas(projectId: number): Promise<CanvasDto> {
  return getResult<CanvasDto>(`/api/agent/canvases?projectId=${projectId}`, {
    headers: authHeaders(loadAccessToken()),
  });
}

/**
 * 整体保存画布：viewport/nodes 由调用方 JSON.stringify 后传入字符串
 * （后端 SaveCanvasRequest 按透明字符串存，不解析结构，见 ADR-0011 D3）。
 */
export function saveCanvas(projectId: number, viewport: string, nodes: string): Promise<CanvasDto> {
  return getResult<CanvasDto>(`/api/agent/canvases/${projectId}`, {
    method: "PUT",
    headers: authHeaders(loadAccessToken()),
    body: JSON.stringify({ viewport, nodes }),
  });
}
