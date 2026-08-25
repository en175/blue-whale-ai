import type { PrismaClient } from "@prisma/client";

/** Asset 读路径 repo（Prisma-backed），复用部署的 assets 表。
 *  对齐 Java AssetService.listAssets：只读分页列表。
 *  不含 storage_key 等内部字段（对齐 AssetResponse）。 */

export interface AssetView {
  id: string;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  source: string | null;
  created_at: string | null;
  size: number | null;
  generation_job_id: string | null;
  project_id: string | null;
  mime: string | null;
  model: string | null;
}

export interface AssetPage {
  records: AssetView[];
  total: number;
  size: number;
  current: number;
}

export interface AssetListFilter {
  type?: string;
  page: number;
  size: number;
}

/** access/content/Agent resolve 端点需要的内部投影：验归属后读受控元数据。
 *  对齐 Java ProjectAssetAccessService/ProjectAssetContentService 的 Asset 取用字段。 */
/** Agent 读取素材时需要的字段集合。
 *  不含 `content_sha256`：它此前只为 `deriveAssetContentVersion` 而取，内容版本校验已撤除
 *  （IKASSI）。而且按下方 `AssetSourceFields` 的注释，部署表 `assets` 本就没有这一列。 */
export interface AssetInternal {
  storage_key: string | null;
  type: string;
  mime: string | null;
  size: bigint | null;
  duration_seconds: number | null;
}

/** 跨项目复制时从源行拷贝的字段集合（对齐 Java AssetCopyService 逐字段 set）。
 *  部署表 assets 无 content_sha256 / source_asset_id / generation_job_id 列，故不携带。 */
export interface AssetSourceFields {
  type: string;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  duration_ms?: number | null;
  source: string;
}

export interface PendingUploadAsset {
  id: string;
  type: string;
  storage_key: string;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface AssetRepo {
  listByUser(userId: string, filter: AssetListFilter): Promise<AssetPage>;
  /** 逻辑删除当前用户自己的未删除 Asset；不存在或不归属返回 false。 */
  softDeleteOwned(assetId: string, userId: string): Promise<boolean>;
  /** 取当前用户在指定项目下的正常资产（access/content 用）；不存在/不归属/已删 → null。 */
  findAccessible(
    projectId: string,
    assetId: string,
    userId: string,
  ): Promise<AssetInternal | null>;
  /** 取当前用户拥有的正常源资产（跨项目复制用）；不存在/不归属/非正常 → null。 */
  findOwnedSource(
    sourceAssetId: string,
    userId: string,
  ): Promise<AssetSourceFields | null>;
  /** 在目标项目落下资产副本行（与源共享 storage_key 物理对象），返回新副本视图。 */
  insertCopy(
    projectId: string,
    userId: string,
    source: AssetSourceFields,
  ): Promise<AssetView>;
  createPendingUpload(input: {
    userId: string;
    type: "image" | "video";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
  }): Promise<string>;
  findPendingUpload(
    assetId: string,
    userId: string,
  ): Promise<PendingUploadAsset | null>;
  markUploadReady(assetId: string, userId: string): Promise<boolean>;
  findCommittedUpload(
    userId: string,
    storageKey: string,
  ): Promise<PendingUploadAsset | null>;
  createUploadedAsset(input: {
    userId: string;
    projectId: string;
    type: "image" | "video" | "audio";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
  }): Promise<PendingUploadAsset>;
}

const uploadAssetSelect = {
  id: true,
  type: true,
  storage_key: true,
  url: true,
  mime: true,
  size: true,
  width: true,
  height: true,
  duration: true,
  duration_ms: true,
} as const;

export function assetDurationSeconds(
  duration: number | null,
  durationMs: number | null | undefined,
): number | null {
  return durationMs == null ? duration : durationMs / 1000;
}

function toUploadAsset(row: {
  id: bigint;
  type: string;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  duration_ms: number | null;
}): PendingUploadAsset | null {
  if (!row.storage_key) return null;
  const { duration_ms: durationMs, ...asset } = row;
  return {
    ...asset,
    id: row.id.toString(),
    storage_key: row.storage_key,
    duration: assetDurationSeconds(row.duration, durationMs),
  };
}

/** 按 assets 行批量解析生成模型展示名：jobId → model_label（无展示名回退 model_id）。
 *  model_id 取任务 input 的顶层 model_id 或 parameters.model_id（场景卡等路径）。 */
async function resolveAssetModels(
  prisma: PrismaClient,
  rows: { generation_job_id: bigint | null }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const jobIds = rows
    .map((a) => a.generation_job_id)
    .filter((id): id is bigint => id != null);
  if (jobIds.length === 0) return result;

  const jobs = await prisma.generation_jobs.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, input: true },
  });
  const modelIdByJob = new Map<string, string>();
  const modelIds = new Set<string>();
  for (const job of jobs) {
    const input = job.input as
      | { model_id?: string; parameters?: { model_id?: string } }
      | null
      | undefined;
    const modelId = input?.model_id ?? input?.parameters?.model_id;
    if (modelId) {
      modelIdByJob.set(job.id.toString(), modelId);
      modelIds.add(modelId);
    }
  }
  if (modelIds.size === 0) return result;

  const caps = await prisma.generation_model_capability.findMany({
    where: { model_id: { in: [...modelIds] }, enabled: true, is_delete: false },
    select: { model_id: true, model_label: true },
  });
  const labelByModel = new Map<string, string>();
  for (const cap of caps) {
    if (!labelByModel.has(cap.model_id)) labelByModel.set(cap.model_id, cap.model_label);
  }
  for (const [jobId, modelId] of modelIdByJob) {
    result.set(jobId, labelByModel.get(modelId) ?? modelId);
  }
  return result;
}

export function createAssetRepo(prisma: PrismaClient): AssetRepo {
  return {
    async softDeleteOwned(assetId, userId) {
      const result = await prisma.assets.updateMany({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
        data: {
          is_delete: true,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      return result.count === 1;
    },
    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: false,
        ...(filter.type ? { type: filter.type } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.assets.count({ where }),
        prisma.assets.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);
      // 生成模型溯源：按 generation_job_id 批量回查任务 input 的 model_id，再查能力表展示名。
      // 兜底顺序：展示名 → model_id → null（上传资产/任务无模型/查询失败均落到 null 或回退）。
      const modelByJobId = await resolveAssetModels(prisma, rows);
      return {
        records: rows.map((a) => ({
          id: a.id.toString(),
          type: a.type,
          url: a.url,
          width: a.width,
          height: a.height,
          duration: assetDurationSeconds(a.duration, a.duration_ms),
          source: a.source ?? null,
          created_at: a.gmt_create?.toISOString() ?? null,
          size: a.size == null ? null : Number(a.size),
          generation_job_id:
            a.generation_job_id == null ? null : a.generation_job_id.toString(),
          project_id: a.project_id == null ? null : a.project_id.toString(),
          mime: a.mime ?? null,
          model:
            a.generation_job_id == null
              ? null
              : (modelByJobId.get(a.generation_job_id.toString()) ?? null),
        })),
        total,
        size: filter.size,
        current: filter.page,
      };
    },
    async findAccessible(projectId, assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          project_id: BigInt(projectId),
          user_id: BigInt(userId),
          status: "normal",
          is_delete: false,
        },
        select: {
          storage_key: true,
          type: true,
          mime: true,
          size: true,
          duration: true,
          duration_ms: true,
        },
      });
      return row
        ? {
            storage_key: row.storage_key,
            type: row.type,
            mime: row.mime,
            size: row.size,
            duration_seconds: assetDurationSeconds(
              row.duration,
              row.duration_ms,
            ),
          }
        : null;
    },
    async findOwnedSource(sourceAssetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(sourceAssetId),
          user_id: BigInt(userId),
          status: "normal",
          is_delete: false,
        },
      });
      if (!row) return null;
      return {
        type: row.type,
        storage_key: row.storage_key,
        url: row.url,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        duration: row.duration,
        duration_ms: row.duration_ms,
        source: row.source,
      };
    },
    async insertCopy(projectId, userId, source) {
      const row = await prisma.assets.create({
        data: {
          project_id: BigInt(projectId),
          user_id: BigInt(userId),
          type: source.type,
          storage_key: source.storage_key,
          url: source.url,
          mime: source.mime,
          size: source.size,
          width: source.width,
          height: source.height,
          duration: source.duration,
          duration_ms: source.duration_ms ?? null,
          source: source.source,
          status: "normal",
        },
      });
      return {
        id: row.id.toString(),
        type: row.type,
        url: row.url,
        width: row.width,
        height: row.height,
        duration: assetDurationSeconds(row.duration, row.duration_ms),
        source: row.source ?? null,
        created_at: row.gmt_create?.toISOString() ?? null,
        size: row.size == null ? null : Number(row.size),
        generation_job_id:
          row.generation_job_id == null ? null : row.generation_job_id.toString(),
        project_id: row.project_id == null ? null : row.project_id.toString(),
        mime: row.mime ?? null,
        model: null,
      };
    },
    async createPendingUpload(input) {
      const row = await prisma.assets.create({
        data: {
          user_id: BigInt(input.userId),
          project_id: BigInt(0),
          type: input.type,
          storage_key: input.storageKey,
          url: input.url,
          mime: input.mime,
          size: BigInt(input.size),
          source: "uploaded",
          status: "uploading",
        },
      });
      return row.id.toString();
    },
    async findPendingUpload(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "uploading",
          is_delete: false,
        },
        select: {
          id: true,
          type: true,
          storage_key: true,
          url: true,
          mime: true,
          size: true,
          width: true,
          height: true,
          duration: true,
        },
      });
      if (!row?.storage_key) return null;
      return {
        ...row,
        id: row.id.toString(),
        storage_key: row.storage_key,
      };
    },
    async markUploadReady(assetId, userId) {
      const result = await prisma.assets.updateMany({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "uploading",
          is_delete: false,
        },
        data: { status: "normal", version: { increment: 1 } },
      });
      return result.count === 1;
    },
    async findCommittedUpload(userId, storageKey) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          storage_key: storageKey,
          status: "normal",
          is_delete: false,
        },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async createUploadedAsset(input) {
      const row = await prisma.assets.create({
        data: {
          user_id: BigInt(input.userId),
          project_id: BigInt(input.projectId),
          type: input.type,
          storage_key: input.storageKey,
          url: input.url,
          mime: input.mime,
          size: BigInt(input.size),
          ...(input.width == null ? {} : { width: input.width }),
          ...(input.height == null ? {} : { height: input.height }),
          ...(input.duration == null ? {} : { duration: Math.round(input.duration) }),
          ...(input.duration == null
            ? {}
            : { duration_ms: Math.round(input.duration * 1000) }),
          source: "uploaded",
          status: "normal",
        },
        select: uploadAssetSelect,
      });
      const asset = toUploadAsset(row);
      if (!asset) throw new Error("Committed upload is missing storage_key");
      return asset;
    },
  };
}
