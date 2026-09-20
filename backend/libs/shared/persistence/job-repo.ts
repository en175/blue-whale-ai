import type { PrismaClient } from "@prisma/client";

import {
  VOCAL_SPLIT_JOB_TYPE,
  VOCAL_SPLIT_SCENE_TRACKS,
} from "@lib/contracts";

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
  /** IKFM3S §4：快照里的文本输入签名投影（前端轮询成功后回写目标 usedInputSignature）；无则 null。 */
  text_input_signature: string | null;
  /** IKHA2J：vocal_split 成功时的逐轨结果（契约 VocalSplitTrackResult 结构，轨序 = 契约
   *  SCENE_TRACKS[scene]，与 output_asset_ids 写入顺序一致）；非 vocal_split / 未成功为 null。
   *  asset（首个产出）保持不动——既有单 asset 消费者不受影响。 */
  tracks: JobVocalSplitTrack[] | null;
}

/** vocal_split 单轨投影（契约 VocalSplitTrackResult 逐字段：轨类型 + 资产 id + url + 时长秒）。 */
export interface JobVocalSplitTrack {
  track_type: string;
  asset_id: string;
  url: string;
  duration: number | null;
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
  /** IKHA2J：vocal_split 轨投影的时长秒换算源（findMany 全列天然带上，其余消费方不读）。 */
  duration_ms: number | null;
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

      // IKHA2J：vocal_split 多轨投影（契约 VocalSplitTrackResult）。轨类型不落库（assets 无
      // 轨类型列）——按 output_asset_ids 写入顺序（= worker 终态按契约 SCENE_TRACKS 轨序拼的
      // 数组）与 input.scene 的契约轨序逐下标 zip 组装；脏数据（长度不齐 / scene 非法）按短侧
      // 截断安全降级，不影响 asset 单对象投影。
      let tracks: JobStatusView["tracks"] = null;
      if (row.status === "succeeded" && row.type === VOCAL_SPLIT_JOB_TYPE) {
        const ids = parseAssetIds(row.output_asset_ids);
        const scene =
          row.input && typeof row.input === "object" && !Array.isArray(row.input)
            ? (row.input as Record<string, unknown>).scene
            : undefined;
        const trackOrder =
          typeof scene === "string" && scene in VOCAL_SPLIT_SCENE_TRACKS
            ? VOCAL_SPLIT_SCENE_TRACKS[scene as keyof typeof VOCAL_SPLIT_SCENE_TRACKS]
            : undefined;
        if (trackOrder && ids.length > 0) {
          const assetMap = await loadAssets(ids);
          const zipLength = Math.min(ids.length, trackOrder.length);
          tracks = [];
          for (let i = 0; i < zipLength; i++) {
            const id = ids[i];
            const trackType = trackOrder[i];
            if (id === undefined || trackType === undefined) continue;
            const a = assetMap.get(id.toString());
            tracks.push({
              track_type: trackType,
              asset_id: id.toString(),
              url: a?.url ?? "",
              duration: a?.duration_ms != null ? a.duration_ms / 1000 : null,
            });
          }
        }
      }

      return {
        job_id: row.id.toString(),
        project_id: row.project_id?.toString() ?? "",
        type: row.type,
        status: row.status,
        progress: row.progress,
        asset,
        tracks,
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
