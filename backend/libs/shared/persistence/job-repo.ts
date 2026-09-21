import type { PrismaClient } from "@prisma/client";

import { VIDEO_SCENE_SPLIT_JOB_TYPE } from "@lib/contracts";

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
  /** 成功时的全部产出资源（按 output_asset_ids 顺序）；一对一工具与 asset 首元素等价，
   *  一对多工具（场景切分扇出）按序消费（IKH8C1）。 */
  output_assets: JobOutputAsset[];
  /** 一对多任务的契约 result（当前仅 video_scene_split：duration + segments[] 起止秒与段资产引用），
   *  取自终态日志 payload；非该形态任务或无日志时为 null。 */
  result: Record<string, unknown> | null;
  /** 失败时 DB 存的原始 error map；无则 null。投影成公开信封是 handler 层职责。 */
  stored_error: Record<string, unknown> | null;
  /** IKFM3S §4：快照里的文本输入签名投影（前端轮询成功后回写目标 usedInputSignature）；无则 null。 */
  text_input_signature: string | null;
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

      let outputAssets: JobOutputAsset[] = [];
      if (row.status === "succeeded") {
        const ids = parseAssetIds(row.output_asset_ids);
        const assetMap = await loadAssets(ids);
        outputAssets = ids
          .map((id) => assetMap.get(id.toString()))
          .filter((a): a is AssetRow => a !== undefined)
          .map((a) => ({
            id: a.id.toString(),
            url: a.url,
            type: a.type,
            width: a.width,
            height: a.height,
          }));
      }
      const firstAsset = outputAssets[0];
      const asset = firstAsset
        ? { id: firstAsset.id, url: firstAsset.url, type: firstAsset.type }
        : null;

      // 一对多 result（IKH8C1 场景切分扇出）：终态日志 payload 承载 duration + segments，
      // 仅该形态任务查询，其余任务不多付一次 log 查询。
      let result: JobStatusView["result"] = null;
      if (row.status === "succeeded" && row.type === VIDEO_SCENE_SPLIT_JOB_TYPE) {
        const logRow = await prisma.generation_job_logs.findFirst({
          where: { generation_job_id: row.id, status: "succeeded" },
          orderBy: { occurred_at: "desc" },
          select: { payload: true },
        });
        if (
          logRow?.payload &&
          typeof logRow.payload === "object" &&
          !Array.isArray(logRow.payload)
        ) {
          result = logRow.payload as Record<string, unknown>;
        }
      }

      return {
        job_id: row.id.toString(),
        project_id: row.project_id?.toString() ?? "",
        type: row.type,
        status: row.status,
        progress: row.progress,
        asset,
        output_assets: outputAssets,
        result,
        stored_error:
          row.error && typeof row.error === "object" && !Array.isArray(row.error)
            ? (row.error as Record<string, unknown>)
            : null,
        text_input_signature:
          row.input && typeof row.input === "object" && !Array.isArray(row.input)
            ? (() => {
                const signature = (row.input as Record<string, unknown>).text_input_signature;
                return typeof signature === "string" ? signature : null;
              })()
            : null,
      };
    },
  };
}
