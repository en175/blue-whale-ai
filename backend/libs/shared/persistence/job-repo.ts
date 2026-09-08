import type { PrismaClient } from "@prisma/client";

import { publicGenerationInput } from "./generation-input.js";

/** GenerationJob 读路径的 db port（Prisma-backed），复用部署的 generation_jobs / assets 表。
 *  对齐 Java GenerationJobService：只读（列表分页 + 状态单查），写入仍由 Java 队列路径负责。
 *  字段 snake_case 对齐 Jackson SNAKE_CASE wire 格式。 */

export interface JobListItem {
  job_id: string;
  type: string;
  status: string;
  progress: number;
  input: unknown;
  created_at: string;
  output_assets: JobOutputAsset[];
  /** Node handler projects this internal field into a public error envelope. */
  stored_error?: Record<string, unknown> | null;
}

export interface JobOutputAsset {
  id: string;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
}

export interface JobStatusView {
  job_id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  /** 成功时的首个产出资源；无则 null。 */
  asset: { id: string; url: string; type: string } | null;
  /** 失败时 DB 存的原始 error map；无则 null。投影成公开信封是 handler 层职责。 */
  stored_error: Record<string, unknown> | null;
}

export interface JobPage {
  records: JobListItem[];
  total: number;
  size: number;
  current: number;
}

export interface JobListFilter {
  type?: string;
  status?: string;
  projectId?: string;
  ids?: string[];
  page: number;
  size: number;
}

export interface JobRepo {
  listByUser(userId: string, filter: JobListFilter): Promise<JobPage>;
  findByIdForUser(jobId: string, userId: string): Promise<JobStatusView | null>;
}

type AssetRow = {
  id: bigint;
  url: string;
  type: string;
  width: number | null;
  height: number | null;
};

function parseAssetIds(json: unknown): bigint[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) => (typeof v === "number" || typeof v === "string" ? BigInt(v) : null))
    .filter((v): v is bigint => v !== null);
}

export function createJobRepo(prisma: PrismaClient): JobRepo {
  async function loadAssets(ids: bigint[]): Promise<Map<string, AssetRow>> {
    if (ids.length === 0) return new Map();
    const rows: AssetRow[] = await prisma.assets.findMany({
      where: { id: { in: ids }, is_delete: false },
    });
    return new Map(rows.map((r) => [r.id.toString(), r]));
  }

  return {
    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: false,
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.projectId ? { project_id: BigInt(filter.projectId) } : {}),
        ...(filter.ids ? { id: { in: [...new Set(filter.ids)].map((id) => BigInt(id)) } } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.generation_jobs.count({ where }),
        prisma.generation_jobs.findMany({
          where,
          orderBy: { gmt_create: "desc" },
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);

      // 一次性批量查产出 assets，避免 N+1（对齐 Java selectBatchIds）。
      const allIds = rows.flatMap((r) => parseAssetIds(r.output_asset_ids));
      const assetMap = await loadAssets([...new Set(allIds)]);

      const records: JobListItem[] = rows.map((r) => ({
        job_id: r.id.toString(),
        type: r.type,
        status: r.status,
        progress: r.progress,
        input: publicGenerationInput(r.input ?? null),
        created_at: r.gmt_create.toISOString(),
        output_assets: parseAssetIds(r.output_asset_ids)
          .map((id) => assetMap.get(id.toString()))
          .filter((a): a is AssetRow => a !== undefined)
          .map((a) => ({
            id: a.id.toString(),
            url: a.url,
            type: a.type,
            width: a.width,
            height: a.height,
          })),
        stored_error:
          r.error && typeof r.error === "object" && !Array.isArray(r.error)
            ? (r.error as Record<string, unknown>)
            : null,
      }));

      return { records, total, size: filter.size, current: filter.page };
    },

    async findByIdForUser(jobId, userId) {
      const row = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
      });
      if (!row) return null;

      let asset: JobStatusView["asset"] = null;
      if (row.status === "succeeded") {
        const firstId = parseAssetIds(row.output_asset_ids)[0];
        if (firstId !== undefined) {
          const a = await prisma.assets.findFirst({
            where: { id: firstId, is_delete: false },
          });
          if (a) asset = { id: a.id.toString(), url: a.url, type: a.type };
        }
      }

      return {
        job_id: row.id.toString(),
        project_id: row.project_id?.toString() ?? "",
        type: row.type,
        status: row.status,
        progress: row.progress,
        asset,
        stored_error:
          row.error && typeof row.error === "object" && !Array.isArray(row.error)
            ? (row.error as Record<string, unknown>)
            : null,
      };
    },
  };
}
