import { fail, ok, type ResultEnvelope } from "@blue-whale/contracts";
import type {
  CanvasRepo,
  CanvasView,
  ProjectRepo,
  ProjectView,
  SnapshotAssetRow,
  SnapshotRepo,
} from "@blue-whale/persistence";

import { projectPublicError, type PublicJobError } from "../jobs/public-error";

/** Java SystemCode.RESOURCE_NOT_FOUND_CODE：归属/资源不存在一律不泄漏。 */
const RESOURCE_NOT_FOUND_CODE = 100301;

/** Snapshot 信封里的 generation_job 摘要（对齐 Java GenerationJobDto，snake_case wire）。 */
export interface SnapshotGenerationJob {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  error: PublicJobError | null;
}

/** assets map 项（对齐 Java AssetDto：{asset_id, access_url, type}）。 */
export interface SnapshotAssetSummary {
  asset_id: string;
  access_url: string;
  type: string;
}

/** GET /api/projects/{id}/snapshot 返回的快照（对齐 Java SnapshotResponse + 前端 ProjectSnapshot）。
 *  conversation_messages / agent_runs 在部署 schema 无对应表 → 暂空（SSE 增量补齐）。
 *  high_watermark_cursor 同理暂返 0（project_events 表未建）。 */
export interface SnapshotData {
  project: ProjectView;
  canvas: CanvasView;
  conversation_messages: readonly unknown[];
  agent_runs: readonly unknown[];
  generation_jobs: SnapshotGenerationJob[];
  assets: Record<string, SnapshotAssetSummary>;
  high_watermark_cursor: number;
}

export interface SnapshotDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  canvas: Pick<CanvasRepo, "getByProject">;
  snapshot: SnapshotRepo;
}

/** Snapshot 直接暴露 Asset 持久化 URL，Canvas/下载方无需再换取产品代理地址。 */
export function assetAccessUrl(
  _projectId: string,
  asset: {
    id: string;
    type: string;
    url: string;
    project_id: string | null;
  },
): string {
  return asset.url;
}

function toWireJob(job: {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  stored_error: Record<string, unknown> | null;
}): SnapshotGenerationJob {
  return {
    job_id: job.job_id,
    type: job.type,
    source: job.source,
    status: job.status,
    progress: job.progress,
    input: job.input,
    output_asset_ids: job.output_asset_ids,
    error:
      job.status === "failed"
        ? projectPublicError(job.stored_error, job.type)
        : null,
  };
}

/** GET /api/projects/{projectId}/snapshot：先验归属（100301 不泄漏）→ 聚合 project/canvas/jobs/assets。 */
export async function handleGetSnapshot(
  userId: string,
  projectId: string,
  deps: SnapshotDeps,
): Promise<ResultEnvelope<SnapshotData>> {
  const project = await deps.projects.findOwnedById(projectId, userId);
  if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const canvas = await deps.canvas.getByProject(projectId);
  const { generation_jobs, assets } =
    await deps.snapshot.loadJobsAndAssets(projectId);

  const assetMap: Record<string, SnapshotAssetSummary> = {};
  for (const asset of assets) {
    assetMap[asset.id] = {
      asset_id: asset.id,
      access_url: assetAccessUrl(projectId, asset),
      type: asset.type,
    };
  }

  return ok({
    project,
    canvas,
    conversation_messages: [],
    agent_runs: [],
    generation_jobs: generation_jobs.map(toWireJob),
    assets: assetMap,
    high_watermark_cursor: 0,
  });
}

// 仅类型再导出，方便 deps 装配处按需引用
export type { SnapshotAssetRow };
