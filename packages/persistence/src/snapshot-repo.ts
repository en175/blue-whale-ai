import type { PrismaClient } from "@prisma/client";

import { publicGenerationInput } from "./generation-input.js";

/** Snapshot 读路径的 job + asset 聚合 db port（Prisma-backed）。
 *  对齐 Java SnapshotService 项目级 GenerationJob 与 Asset 引用读取：
 *  - generation_jobs 按 project_id 过滤、gmt_create desc。
 *  - 按 project_id 一次读取全部 normal assets（包含上传与生成产物，防 N+1）。
 *  对齐部署 schema：conversation_messages / agent_runs / generation_job_outputs /
 *  project_events 表暂无 → 这些切片由 handler 补空数组与 cursor 0。字段 snake_case。 */

export interface SnapshotJobView {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  /** DB 原始 error（结构化 map）；投影成公开信封是 handler 层职责。 */
  stored_error: Record<string, unknown> | null;
}

export interface SnapshotAssetRow {
  id: string;
  type: string;
  url: string;
  /** assets.project_id 在部署 schema 非空（默认 0）；理论可空时按全局 asset 处理。 */
  project_id: string | null;
}

export interface SnapshotJobAggregate {
  generation_jobs: SnapshotJobView[];
  assets: SnapshotAssetRow[];
}

export interface SnapshotRepo {
  loadJobsAndAssets(projectId: string): Promise<SnapshotJobAggregate>;
}

/** output_asset_ids（Json 数组）→ string[]。容忍 number/string 混合（历史数据）。 */
function parseAssetIdList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) =>
      typeof v === "number" || typeof v === "string" ? String(v) : null,
    )
    .filter((v): v is string => v !== null);
}

/** error 列 → 受控 map（仅非数组的 plain object），否则 null。 */
function toStoredError(json: unknown): Record<string, unknown> | null {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return null;
}

export function createSnapshotRepo(prisma: PrismaClient): SnapshotRepo {
  return {
    async loadJobsAndAssets(projectId) {
      const pid = BigInt(projectId);
      const jobs = await prisma.generation_jobs.findMany({
        where: { project_id: pid, is_delete: false },
        orderBy: { gmt_create: "desc" },
      });

      const assetRows = await prisma.assets.findMany({
        where: { project_id: pid, status: "normal", is_delete: false },
      });

      // 对齐 Java：仅保留归属本项目的 asset（防跨项目泄漏）。
      const assets: SnapshotAssetRow[] = [];
      for (const a of assetRows) {
        const rowProjectId =
          a.project_id == null ? null : a.project_id.toString();
        if (rowProjectId !== null && rowProjectId !== projectId) continue;
        assets.push({
          id: a.id.toString(),
          type: a.type,
          url: a.url,
          project_id: rowProjectId,
        });
      }

      const generation_jobs: SnapshotJobView[] = jobs.map((job) => ({
        job_id: job.id.toString(),
        type: job.type,
        source: job.source,
        status: job.status,
        progress: job.progress,
        input: publicGenerationInput(job.input ?? null),
        output_asset_ids: parseAssetIdList(job.output_asset_ids),
        stored_error: toStoredError(job.error),
      }));

      return { generation_jobs, assets };
    },
  };
}
