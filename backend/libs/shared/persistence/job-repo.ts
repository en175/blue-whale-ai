import type { PrismaClient } from "@prisma/client";

import {
  VIDEO_SCENE_SPLIT_JOB_TYPE,
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
  canvas_card_state?: string;
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
  asset: { id: string; url: string; type: string; duration?: number } | null;
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
  /** 管理端列表（offset 分页，全站）。**不供用户端使用**——那条路是 listByUser。 */
  listForAdmin(filter: AdminJobListFilter): Promise<AdminJobPage>;
}

/**
 * 管理端任务记录的一行。
 *
 * <p>与 {@link JobListItem} 的差别只有三处，都是有意的：
 * <ul>
 *   <li>带 {@code user_id} / {@code project_id}——管理端必须能回答「这是谁的任务」，
 *       用户端不需要（他自己就是那个人）</li>
 *   <li>带 {@code model_id} / {@code model_label}——见下方字段注释</li>
 *   <li>**不带产出资料**——管理端看的是任务的状态，去拉一遍 assets 只是多一轮
 *       查询与 N+1，而列表里那一列缩略图没人看。要看产出请按 job_id 走详情。</li>
 * </ul>
 */
export interface AdminJobListItem {
  job_id: string;
  user_id: string;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  provider: string | null;
  /**
   * 这次任务用的模型（`generation_jobs.input.model_id`）。
   *
   * <p>⚠️ **只取 input 里的这一个键**，不把整份 input 搬上列表：input 里有提示词、素材 id、
   * 规格参数，列表一次 20 行，为了一列把它整份带出去，接口体积会随 input 的结构一起长。
   *
   * <p>为空是**正常情况**：免费工具族（抠图、混音一类）没有模型，历史任务用的模型也可能已下架。
   */
  model_id: string | null;
  /**
   * 模型的展示名（`generation_model_capability.model_label`）。
   *
   * <p>`null` = 能力表里查不到这个 model_id —— 由调用方决定怎么显示，**不要在这里编一个名字**。
   * 前端的口径是「有展示名用展示名，否则原样显示 {@link #model_id}」。
   */
  model_label: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  /**
   * 库里存的原始 error map。**本层不投影**——投影（→ {@code {code,message}}）在
   * `JobsService` 那一层做，因为投影器住在 jobs 模块，persistence 反向引它会成环。
   * 与 `listByUser` 的 `stored_error` 同一口径。
   */
  stored_error: Record<string, unknown> | null;
}

export interface AdminJobPage {
  records: AdminJobListItem[];
  total: number;
  size: number;
  current: number;
}

/** 管理端任务列表的筛选条件。 */
export interface AdminJobListFilter {
  /** 按用户过滤；不传 = 全部用户 */
  userId?: string;
  projectId?: string;
  type?: string;
  status?: string;
  page: number;
  size: number;
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

/**
 * 任务 input 里的模型 id；没有就是 `null`。
 *
 * <p>宽容读取（不是 strict schema）：老任务、免费工具族的 input 形态各不相同，
 * 管理端列表要能显示它们，不该因为一个字段的形状不认识就整页报错。
 * `null` 的语义是「这个任务没有模型」——**不等于**「读不出来」。
 */
function modelIdOf(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = (input as { model_id?: unknown }).model_id;
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/**
 * 一批 model_id → 展示名。
 *
 * <p>一次批量查，不逐行查（列表 20 行就是 20 次往返，正是这种 N+1 让列表页越用越慢）。
 *
 * <p>⚠️ **不过滤 `enabled` / `is_delete`**：与用户面（`asset-repo` 只认在架模型）不同，
 *    管理端看的是**已经发生过的事**——一个模型下架了、停用了，历史任务那一列仍该显示
 *    「当时用的是哪个模型」，退化成内部 id 只会让人更看不懂。
 *    `model_id` 在能力表里按 (provider, model_id) 唯一，同一 model_id 可能有多个 provider
 *    各给一个名字；按 id 升序取第一条，让同一批数据每次显示同一个名字。
 */
async function loadModelLabels(
  prisma: PrismaClient,
  modelIds: readonly string[],
): Promise<Map<string, string>> {
  if (modelIds.length === 0) return new Map();
  const caps = await prisma.generation_model_capability.findMany({
    where: { model_id: { in: [...modelIds] } },
    select: { model_id: true, model_label: true },
    orderBy: { id: "asc" },
  });
  const labelByModel = new Map<string, string>();
  for (const cap of caps) {
    if (!labelByModel.has(cap.model_id)) labelByModel.set(cap.model_id, cap.model_label);
  }
  return labelByModel;
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
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
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
        ...(r.type === "audio_mix" ? { canvas_card_state: r.canvas_card_state } : {}),
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

    async listForAdmin(filter) {
      const where = {
        is_delete: false,
        ...(filter.userId !== undefined ? { user_id: BigInt(filter.userId) } : {}),
        ...(filter.projectId !== undefined ? { project_id: BigInt(filter.projectId) } : {}),
        ...(filter.type !== undefined ? { type: filter.type } : {}),
        ...(filter.status !== undefined ? { status: filter.status } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.generation_jobs.count({ where }),
        prisma.generation_jobs.findMany({
          where,
          // 次级键 id 与 listByUser 同款：DATETIME 只到秒，同一秒建多个任务很常见，
          // 只按时间排序时翻页会跳行或重复行。
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);

      // 先把这一页用到的 model_id 收齐再一次性查展示名（见 loadModelLabels 的注释）
      const modelIds = new Set<string>();
      for (const r of rows) {
        const modelId = modelIdOf(r.input);
        if (modelId !== null) modelIds.add(modelId);
      }
      const labelByModel = await loadModelLabels(prisma, [...modelIds]);

      return {
        records: rows.map((r) => {
          const modelId = modelIdOf(r.input);
          return {
            job_id: r.id.toString(),
            user_id: r.user_id.toString(),
            project_id: r.project_id?.toString() ?? "",
            type: r.type,
            status: r.status,
            progress: r.progress,
            provider: r.provider,
            model_id: modelId,
            // 查得到展示名就给展示名（中文名是能力表里维护的，别在这里另造一个）；
            // 查不到就给 null，由前端原样显示 model_id
            model_label: modelId === null ? null : (labelByModel.get(modelId) ?? null),
            retry_count: r.retry_count,
            created_at: r.gmt_create.toISOString(),
            updated_at: r.gmt_modified.toISOString(),
            stored_error:
              r.error && typeof r.error === "object" && !Array.isArray(r.error)
                ? (r.error as Record<string, unknown>)
                : null,
          };
        }),
        total,
        size: filter.size,
        current: filter.page,
      };
    },

    async findByIdForUser(jobId, userId) {
      const row = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
      });
      if (!row) return null;

      let outputAssets: JobOutputAsset[] = [];
      let audioMixDurationMs: number | null = null;
      if (row.status === "succeeded") {
        const ids = parseAssetIds(row.output_asset_ids);
        const assetMap = await loadAssets(ids);
        if (row.type === "audio_mix" && ids[0] !== undefined) {
          audioMixDurationMs = assetMap.get(ids[0].toString())?.duration_ms ?? null;
        }
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
        ? {
            id: firstAsset.id,
            url: firstAsset.url,
            type: firstAsset.type,
            ...(audioMixDurationMs != null ? { duration: audioMixDurationMs / 1000 } : {}),
          }
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
