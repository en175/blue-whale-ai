/**
 * canvas —— project / canvas 持久化请求层。
 *
 * 统一走 apiRequest（lib/api-client）：自动附 Authorization + X-User-Id，
 * 收到 401 自动刷新 token 并重试，用户无感。本地走 Next rewrite
 * /api/agent/* → 网关 → agent-service，浏览器同源无 CORS。
 */
import { apiRequest } from "./api-client";

/** 项目响应（列表/详情），对齐后端 ProjectDto。 */
export interface ProjectDto {
  id: number;
  name: string;
  thumb: string | null;
  createdAt: string;
}

/** 画布响应（整体 GET），对齐后端 CanvasDto；viewport/nodes 为 JSON 字符串。 */
export interface CanvasDto {
  id: number | null;
  projectId: number;
  viewport: string;
  nodes: string;
}

/** 建项目。 */
export function createProject(name: string): Promise<ProjectDto> {
  return apiRequest<ProjectDto>("/api/agent/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** 项目列表（当前用户）。 */
export function listProjects(): Promise<ProjectDto[]> {
  return apiRequest<ProjectDto[]>("/api/agent/projects");
}

/** 项目详情。 */
export function getProject(id: number): Promise<ProjectDto> {
  return apiRequest<ProjectDto>(`/api/agent/projects/${id}`);
}

/** 重命名项目。 */
export function renameProject(id: number, name: string): Promise<ProjectDto> {
  return apiRequest<ProjectDto>(`/api/agent/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

/** 删除项目。 */
export function deleteProject(id: number): Promise<void> {
  return apiRequest<void>(`/api/agent/projects/${id}`, {
    method: "DELETE",
  });
}

/** 加载画布（按 projectId，无记录时 id 为 null）。 */
export function loadCanvas(projectId: number): Promise<CanvasDto> {
  return apiRequest<CanvasDto>(`/api/agent/canvases?projectId=${projectId}`);
}

/**
 * 整体保存画布：viewport/nodes 由调用方 JSON.stringify 后传入字符串
 * （后端 SaveCanvasRequest 按透明字符串存，不解析结构，见 ADR-0011 D3）。
 */
export function saveCanvas(projectId: number, viewport: string, nodes: string): Promise<CanvasDto> {
  return apiRequest<CanvasDto>(`/api/agent/canvases/${projectId}`, {
    method: "PUT",
    body: JSON.stringify({ viewport, nodes }),
  });
}
