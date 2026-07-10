/**
 * endpoints —— typed endpoint 函数（IJZYVR API 客户端骨架）
 *
 * 每个函数对应 BACKEND-API-PRD.md §5 的一个 P0 接口。
 * 函数体是 `apiFetch` 的一行包装 —— 走 `client.ts` 的统一 header / 错误处理。
 *
 * 边界:
 * - 不做 snake_case → camelCase 转换（DTO 直返）;
 *   消费方（feature / hook）按需在 UI 层 map 到 `@/types/domain` 形状
 * - 不做 snake_case 入参转换（前端本身已 snake_case 用得少,字段名贴后端契约）
 * - 不接 SSE 流（`/api/jobs/{id}/stream` / `/api/projects/{id}/agent/turn`）——
 *   留给 IJZYVS / Agent 对话相关 issue
 */

import { apiFetch } from "./client";
import type {
  AssetResponse,
  CatalogResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  GenerateRequest,
  GenerateResponse,
  GetProjectResponse,
  JobResponse,
  ListProjectsResponse,
  MeResponse,
  PatchProjectRequest,
  PresignAssetRequest,
  PresignAssetResponse,
} from "./dto";

const enc = encodeURIComponent;

// ---------- §5.1 ----------
export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/me");
}

// ---------- §5.2 ----------
export function presignAsset(
  req: PresignAssetRequest,
): Promise<PresignAssetResponse> {
  return apiFetch<PresignAssetResponse>("/assets/presign", {
    method: "POST",
    body: req,
  });
}

export function completeAsset(assetId: string): Promise<AssetResponse> {
  return apiFetch<AssetResponse>(`/assets/${enc(assetId)}/complete`, {
    method: "POST",
  });
}

export function getAsset(assetId: string): Promise<AssetResponse> {
  return apiFetch<AssetResponse>(`/assets/${enc(assetId)}`);
}

// ---------- §5.3 ----------
export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>("/catalog");
}

// ---------- §5.4 ----------
/** BottomDock 直生入口:零优化、零图理解,prompt + params + refs 直传 Provider */
export function startGeneration(
  projectId: string,
  req: GenerateRequest,
): Promise<GenerateResponse> {
  return apiFetch<GenerateResponse>(`/projects/${enc(projectId)}/generate`, {
    method: "POST",
    body: req,
  });
}

/** 轮询兜底（SSE 断线时由业务方用）。主推 SSE,见 PRD §8。 */
export function getJob(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/jobs/${enc(jobId)}`);
}

// ---------- §5.5 ----------
export function listProjects(): Promise<ListProjectsResponse> {
  return apiFetch<ListProjectsResponse>("/projects");
}

export function createProject(
  req: CreateProjectRequest,
): Promise<CreateProjectResponse> {
  return apiFetch<CreateProjectResponse>("/projects", {
    method: "POST",
    body: req,
  });
}

export function getProject(projectId: string): Promise<GetProjectResponse> {
  return apiFetch<GetProjectResponse>(`/projects/${enc(projectId)}`);
}

/** 整 Project 快照保存（画布 + 对话 + 视口,前端在变更后调用） */
export function patchProject(
  projectId: string,
  req: PatchProjectRequest,
): Promise<GetProjectResponse> {
  return apiFetch<GetProjectResponse>(`/projects/${enc(projectId)}`, {
    method: "PATCH",
    body: req,
  });
}

export function deleteProject(projectId: string): Promise<void> {
  return apiFetch<void>(`/projects/${enc(projectId)}`, { method: "DELETE" });
}
