import type { PrismaClient } from "@prisma/client";
import { IMAGE_ERASE_MASK_ASSET_SOURCE } from "@lib/contracts";

import { extraNumber, extraString, loadJobExtras } from "./generation-jobs-extra-repo.js";


export interface AssetView {
  id: string;
  name: string | null;
  type: string;
  status: string | null;
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
  material_id: string | null;
  material_status: string | null;
  material_status_checked_at: string | null;
  video_stage: string;
  source_sample_job_id: string | null;
  final_job_id: string | null;
}

export interface AssetDetailView extends AssetView {
  prompt: string | null;
}

export interface VideoStageAssetIdentity {
  video_stage: string;
  source_sample_job_id: string | null;
  final_job_id: string | null;
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

export interface AssetInternal {
  storage_key: string | null;
  type: string;
  mime: string | null;
  size: bigint | null;
  duration_seconds: number | null;
}

export interface AssetSourceFields {
  type: string;
  project_id: bigint;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
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
  material_id: string | null;
}

export interface AssetRepo {
  listByUser(userId: string, filter: AssetListFilter): Promise<AssetPage>;
  softDeleteOwned(assetId: string, userId: string): Promise<boolean>;
  linkAssetToProject(input: {
    userId: string;
    assetId: string;
    projectId: string;
  }): Promise<boolean>;
  countReferencingProjects(assetId: string, userId: string): Promise<number>;
  listGcCandidates(cutoff: Date): Promise<
    { id: bigint; storage_key: string | null }[]
  >;
  findLiveRefs(storageKeys: string[]): Promise<string[]>;
  hardDeleteRows(ids: bigint[]): Promise<number>;
  findAccessible(
    assetId: string,
    userId: string,
  ): Promise<AssetInternal | null>;
  findOwnedSource(
    sourceAssetId: string,
    userId: string,
  ): Promise<AssetSourceFields | null>;
  findOwnedById(assetId: string, userId: string): Promise<AssetDetailView | null>;
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
  findOwnedByMd5(userId: string, md5: string): Promise<PendingUploadAsset | null>;
  findOwnedByMaterialId(userId: string, materialId: string): Promise<PendingUploadAsset | null>;
  bindMaterialId(input: {
    userId: string;
    assetId: string;
    materialId: string;
  }): Promise<boolean>;
  createUploadedAsset(input: {
    userId: string;
    projectId: string;
    name?: string;
    type: "image" | "video" | "audio";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
    md5?: string;
    materialId?: string;
    source?: string;
  }): Promise<PendingUploadAsset>;
  linkAssetToMaterial(input: {
    userId: string;
    assetId: string;
    materialId: string;
  }): Promise<boolean>;
  clearMaterialLink(userId: string, materialId: string): Promise<void>;
  clearMaterialGroupLink(userId: string, materialGroupId: string): Promise<void>;
  findBoundMaterialIds(userId: string, assetIds: readonly string[]): Promise<string[]>;
  findOwnedByMaterialIds(
    userId: string,
    materialIds: readonly string[],
  ): Promise<Array<{ materialId: string; assetId: string; url: string }>>;
  findOwnedMaterialLink(userId: string, assetId: string): Promise<string | null>;
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
  duration_ms: true,
  material_id: true,
} as const;

export function assetDurationSeconds(
  durationMs: number | null | undefined,
): number | null {
  return durationMs == null ? null : durationMs / 1000;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

function isPendingUploadAsset(row: unknown): row is PendingUploadAsset {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as { id?: unknown }).id === "string"
  );
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
  duration_ms: number | null;
  material_id: string | null;
}): PendingUploadAsset | null {
  if (!row.storage_key) return null;
  const { duration_ms: durationMs, ...asset } = row;
  return {
    ...asset,
    id: row.id.toString(),
    storage_key: row.storage_key,
    duration: assetDurationSeconds(durationMs),
  };
}

function promptFromJobInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { prompt, prompt_text: promptText } = input as {
    prompt?: unknown;
    prompt_text?: unknown;
  };
  for (const candidate of [prompt, promptText]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

const MATERIAL_ID_CHUNK = 500;

async function resolveMaterialStatuses(
  prisma: PrismaClient,
  userId: string,
  rows: { material_id?: string | null }[],
): Promise<Map<string, { status: string; checkedAt: string | null }>> {
  const byMaterialId = new Map<string, { status: string; checkedAt: string | null }>();
  const materialIds = [
    ...new Set(
      rows
        .map((a) => a.material_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (materialIds.length === 0) return byMaterialId;

  for (let i = 0; i < materialIds.length; i += MATERIAL_ID_CHUNK) {
    const chunk = materialIds.slice(i, i + MATERIAL_ID_CHUNK);
    const statusRows = await prisma.material_assets.findMany({
      where: { user_id: BigInt(userId), material_id: { in: chunk } },
      select: { material_id: true, status: true, status_checked_at: true },
    });
    for (const row of statusRows) {
      byMaterialId.set(row.material_id, {
        status: row.status,
        checkedAt: row.status_checked_at?.toISOString() ?? null,
      });
    }
  }
  return byMaterialId;
}

async function resolveAssetJobMeta(
  prisma: PrismaClient,
  rows: { generation_job_id: bigint | null }[],
): Promise<{
  modelByJobId: Map<string, string>;
  promptByJobId: Map<string, string>;
  nameByJobId: Map<string, string>;
  stageByJobId: Map<string, VideoStageAssetIdentity>;
}> {
  const modelByJobId = new Map<string, string>();
  const promptByJobId = new Map<string, string>();
  const nameByJobId = new Map<string, string>();
  const stageByJobId = new Map<string, VideoStageAssetIdentity>();
  const jobIds = rows
    .map((a) => a.generation_job_id)
    .filter((id): id is bigint => id != null);
  if (jobIds.length === 0) return { modelByJobId, promptByJobId, nameByJobId, stageByJobId };

  const jobs = await prisma.generation_jobs.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, type: true, input: true, source_sample_job_id: true },
  });
  const extrasByJob = await loadJobExtras(
    prisma,
    jobs.map((job) => job.id.toString()),
  );
  const modelIdByJob = new Map<string, string>();
  const modelIds = new Set<string>();
  for (const job of jobs) {
    nameByJobId.set(job.id.toString(), job.type === "audio_mix"
      ? `音频混合 ${job.id}` : `生成任务 ${job.id}`);
    const extras = extrasByJob.get(job.id.toString());
    const finalJobId = extraNumber(extras, "final_job_id");
    stageByJobId.set(job.id.toString(), {
      video_stage: extraString(extras, "video_stage") ?? "video",
      source_sample_job_id:
        job.source_sample_job_id != null ? job.source_sample_job_id.toString() : null,
      final_job_id: finalJobId != null ? String(finalJobId) : null,
    });
    const input = job.input as
      | { model_id?: string; parameters?: { model_id?: string }; prompt?: unknown }
      | null
      | undefined;
    const modelId = input?.model_id ?? input?.parameters?.model_id;
    if (modelId) {
      modelIdByJob.set(job.id.toString(), modelId);
      modelIds.add(modelId);
    }
    const prompt = promptFromJobInput(input);
    if (prompt !== null) promptByJobId.set(job.id.toString(), prompt);
  }
  if (modelIds.size === 0) return { modelByJobId, promptByJobId, nameByJobId, stageByJobId };

  const caps = await prisma.generation_model_capability.findMany({
    where: { model_id: { in: [...modelIds] }, enabled: true, is_delete: false },
    select: { model_id: true, model_label: true },
  });
  const labelByModel = new Map<string, string>();
  for (const cap of caps) {
    if (!labelByModel.has(cap.model_id)) labelByModel.set(cap.model_id, cap.model_label);
  }
  for (const [jobId, modelId] of modelIdByJob) {
    modelByJobId.set(jobId, labelByModel.get(modelId) ?? modelId);
  }
  return { modelByJobId, promptByJobId, nameByJobId, stageByJobId };
}

function toAssetView(
  a: {
    id: bigint;
    type: string;
    name?: string | null;
    status?: string | null;
    url: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    source: string | null;
    gmt_create: Date | null;
    size: bigint | null;
    generation_job_id: bigint | null;
    project_id: bigint | null;
    mime: string | null;
    material_id?: string | null;
  },
  modelByJobId: Map<string, string>,
  nameByJobId: Map<string, string>,
  statusByMaterialId: Map<string, { status: string; checkedAt: string | null }>,
  stageByJobId: Map<string, VideoStageAssetIdentity>,
): AssetView {
  const stage =
    a.generation_job_id == null
      ? null
      : (stageByJobId.get(a.generation_job_id.toString()) ?? null);
  return {
    id: a.id.toString(),
    name: a.name ?? (a.generation_job_id == null ? null : nameByJobId.get(a.generation_job_id.toString()) ?? null),
    type: a.type,
    status: a.status ?? null,
    url: a.url,
    width: a.width,
    height: a.height,
    duration: assetDurationSeconds(a.duration_ms),
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
    material_id: a.material_id ?? null,
    material_status:
      a.material_id == null
        ? null
        : (statusByMaterialId.get(a.material_id)?.status ?? null),
    material_status_checked_at:
      a.material_id == null
        ? null
        : (statusByMaterialId.get(a.material_id)?.checkedAt ?? null),
    video_stage: stage?.video_stage ?? "video",
    source_sample_job_id: stage?.source_sample_job_id ?? null,
    final_job_id: stage?.final_job_id ?? null,
  };
}

function toAssetDetailView(
  a: Parameters<typeof toAssetView>[0],
  modelByJobId: Map<string, string>,
  nameByJobId: Map<string, string>,
  promptByJobId: Map<string, string>,
  statusByMaterialId: Map<string, { status: string; checkedAt: string | null }>,
  stageByJobId: Map<string, VideoStageAssetIdentity>,
): AssetDetailView {
  return {
    ...toAssetView(a, modelByJobId, nameByJobId, statusByMaterialId, stageByJobId),
    prompt:
      a.generation_job_id == null
        ? null
        : (promptByJobId.get(a.generation_job_id.toString()) ?? null),
  };
}

export function createAssetRepo(prisma: PrismaClient): AssetRepo {
  return {
    async findOwnedById(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
      });
      if (!row) return null;
      const { modelByJobId, promptByJobId, nameByJobId, stageByJobId } = await resolveAssetJobMeta(prisma, [row]);
      const statusByMaterialId = await resolveMaterialStatuses(prisma, userId, [row]);
      return toAssetDetailView(row, modelByJobId, nameByJobId, promptByJobId, statusByMaterialId, stageByJobId);
    },
    async softDeleteOwned(assetId, userId) {
      return prisma.$transaction(async (tx) => {
        const result = await tx.assets.updateMany({
          where: {
            id: BigInt(assetId),
            user_id: BigInt(userId),
            is_delete: false,
          },
          data: {
            is_delete: true,
            deleted_at: new Date(),
            version: { increment: 1 },
            gmt_modified: new Date(),
          },
        });
        if (result.count === 1) {
          await tx.project_asset.updateMany({
            where: { asset_id: BigInt(assetId), user_id: BigInt(userId), is_delete: 0 },
            data: { is_delete: 1, gmt_modified: new Date() },
          });
        }
        return result.count === 1;
      });
    },
    async linkAssetToProject({ userId, assetId, projectId }) {
      const aid = BigInt(assetId);
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const existing = await prisma.assets.findFirst({
        where: { id: aid, user_id: uid, is_delete: false },
        select: { id: true },
      });
      if (!existing) return false;
      await prisma.project_asset.upsert({
        where: {
          user_id_asset_id_project_id: { user_id: uid, asset_id: aid, project_id: pid },
        },
        create: { user_id: uid, asset_id: aid, project_id: pid, is_delete: 0 },
        update: { is_delete: 0, gmt_modified: new Date() },
      });
      return true;
    },
    async countReferencingProjects(assetId, userId) {
      const aid = BigInt(assetId);
      const uid = BigInt(userId);
      const [direct, linked] = await Promise.all([
        prisma.assets.groupBy({
          by: ["project_id"],
          where: { id: aid, user_id: uid, is_delete: false, project_id: { not: BigInt(0) } },
        }),
        prisma.project_asset.groupBy({
          by: ["project_id"],
          where: { asset_id: aid, user_id: uid, is_delete: 0 },
        }),
      ]);
      const ids = new Set<string>();
      for (const row of direct) {
        if (row.project_id === BigInt(0)) continue;
        ids.add(row.project_id.toString());
      }
      for (const row of linked) {
        if (row.project_id === BigInt(0)) continue;
        ids.add(row.project_id.toString());
      }
      if (ids.size === 0) return 0;
      const liveProjects = await prisma.project.findMany({
        where: { id: { in: [...ids].map((id) => BigInt(id)) }, is_delete: 0 },
        select: { id: true },
      });
      return liveProjects.length;
    },
    async listGcCandidates(cutoff) {
      const rows = await prisma.assets.findMany({
        where: { is_delete: true, deleted_at: { not: null, lt: cutoff } },
        select: { id: true, storage_key: true },
        orderBy: { id: "asc" },
        take: 1000,
      });
      return rows.map((row) => ({
        id: row.id,
        storage_key: row.storage_key,
      }));
    },
    async findLiveRefs(storageKeys) {
      if (storageKeys.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: { storage_key: { in: storageKeys }, is_delete: false },
        select: { storage_key: true },
      });
      return [...new Set(rows.map((row) => row.storage_key))].filter(
        (key): key is string => key != null,
      );
    },
    async hardDeleteRows(ids) {
      if (ids.length === 0) return 0;
      const result = await prisma.assets.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    },
    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: false,
        ...(filter.type ? { type: filter.type } : {}),
        NOT: { source: IMAGE_ERASE_MASK_ASSET_SOURCE },
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
      const { modelByJobId, nameByJobId, stageByJobId } = await resolveAssetJobMeta(prisma, rows);
      const statusByMaterialId = await resolveMaterialStatuses(prisma, userId, rows);
      return {
        records: rows.map((a) => toAssetView(a, modelByJobId, nameByJobId, statusByMaterialId, stageByJobId)),
        total,
        size: filter.size,
        current: filter.page,
      };
    },
    async findAccessible(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "normal",
          is_delete: false,
        },
        select: {
          storage_key: true,
          type: true,
          mime: true,
          size: true,
          duration_ms: true,
        },
      });
      return row
        ? {
            storage_key: row.storage_key,
            type: row.type,
            mime: row.mime,
            size: row.size,
            duration_seconds: assetDurationSeconds(row.duration_ms),
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
        project_id: row.project_id,
        storage_key: row.storage_key,
        url: row.url,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        duration_ms: row.duration_ms,
        source: row.source,
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
        select: uploadAssetSelect,
      });
      if (!row?.storage_key) return null;
      return {
        ...row,
        id: row.id.toString(),
        storage_key: row.storage_key,
        duration: assetDurationSeconds(row.duration_ms),
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
    async findOwnedByMd5(userId, md5) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          md5,
          status: "normal",
          is_delete: false,
          NOT: { source: IMAGE_ERASE_MASK_ASSET_SOURCE },
        },
        orderBy: { id: "desc" },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async findOwnedByMaterialId(userId, materialId) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          material_id: materialId,
          status: "normal",
          is_delete: false,
        },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async bindMaterialId({ userId, assetId, materialId }) {
      const uid = BigInt(userId);
      const owned = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: uid,
          is_delete: false,
        },
        select: { id: true, material_id: true },
      });
      if (!owned) return false;
      if (owned.material_id === materialId) {
        return true;
      }
      const apply = () =>
        prisma.$transaction(async (tx) => {
          await tx.assets.updateMany({
            where: {
              material_id: materialId,
              user_id: uid,
              id: { not: owned.id },
            },
            data: {
              material_id: null,
              version: { increment: 1 },
              gmt_modified: new Date(),
            },
          });
          await tx.assets.update({
            where: { id: owned.id },
            data: {
              material_id: materialId,
              version: { increment: 1 },
              gmt_modified: new Date(),
            },
          });
        });

      try {
        await apply();
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        await apply();
      }
      return true;
    },
    async createUploadedAsset(input) {
      const row = await prisma.$transaction(async (tx) => {
        if (input.materialId) {
          await tx.assets.updateMany({
            where: {
              material_id: input.materialId,
              user_id: BigInt(input.userId),
            },
            data: {
              material_id: null,
              version: { increment: 1 },
              gmt_modified: new Date(),
            },
          });
        }
        const created = await tx.assets.create({
          data: {
            user_id: BigInt(input.userId),
            project_id: BigInt(input.projectId),
            type: input.type,
            ...(input.name ? { name: input.name } : {}),
            storage_key: input.storageKey,
            url: input.url,
            mime: input.mime,
            size: BigInt(input.size),
            ...(input.width == null ? {} : { width: input.width }),
            ...(input.height == null ? {} : { height: input.height }),
            ...(input.duration == null
              ? {}
              : { duration_ms: Math.round(input.duration * 1000) }),
            ...(input.md5 ? { md5: input.md5 } : {}),
            ...(input.materialId ? { material_id: input.materialId } : {}),
            source: input.source ?? "uploaded",
            status: "normal",
          },
          select: uploadAssetSelect,
        });
        if (input.projectId !== "0") {
          await tx.project_asset.upsert({
            where: {
              user_id_asset_id_project_id: {
                user_id: BigInt(input.userId),
                asset_id: created.id,
                project_id: BigInt(input.projectId),
              },
            },
            create: {
              user_id: BigInt(input.userId),
              asset_id: created.id,
              project_id: BigInt(input.projectId),
              is_delete: 0,
            },
            update: { is_delete: 0, gmt_modified: new Date() },
          });
        }
        return created;
      }).catch(async (error: unknown) => {
        if (isUniqueViolation(error) && input.materialId) {
          const existing = await prisma.assets.findFirst({
            where: {
              user_id: BigInt(input.userId),
              material_id: input.materialId,
              status: "normal",
              is_delete: false,
            },
            select: uploadAssetSelect,
          });
          const reused = existing ? toUploadAsset(existing) : null;
          if (reused) return reused;
        }
        throw error;
      });
      if (isPendingUploadAsset(row)) return row;
      const asset = toUploadAsset(row);
      if (!asset) throw new Error("Committed upload is missing storage_key");
      return asset;
    },
    async linkAssetToMaterial({ userId, assetId, materialId }) {
      const owned = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
        select: { id: true },
      });
      if (!owned) return false;
      await prisma.assets.update({
        where: { id: owned.id },
        data: {
          material_id: materialId,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      return true;
    },
    async clearMaterialLink(userId, materialId) {
      await prisma.assets.updateMany({
        where: { material_id: materialId, user_id: BigInt(userId) },
        data: {
          material_id: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async clearMaterialGroupLink(userId, materialGroupId) {
      const uid = BigInt(userId);
      const rows = await prisma.material_assets.findMany({
        where: { user_id: uid, material_group_id: materialGroupId },
        select: { material_id: true },
      });
      const materialIds = rows.map((row) => row.material_id);
      if (materialIds.length === 0) return;
      await prisma.assets.updateMany({
        where: { user_id: uid, material_id: { in: materialIds } },
        data: {
          material_id: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async findOwnedByMaterialIds(userId, materialIds) {
      if (materialIds.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: {
          user_id: BigInt(userId),
          material_id: { in: [...materialIds] },
          status: "normal",
          is_delete: false,
        },
        select: { id: true, material_id: true, url: true },
      });
      const out: Array<{ materialId: string; assetId: string; url: string }> = [];
      for (const row of rows) {
        if (row.material_id === null) continue;
        out.push({
          materialId: row.material_id,
          assetId: row.id.toString(),
          url: row.url,
        });
      }
      return out;
    },
    async findOwnedMaterialLink(userId, assetId) {
      if (!/^\d+$/.test(assetId)) return null;
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
        select: { material_id: true },
      });
      return row?.material_id ?? null;
    },
    async findBoundMaterialIds(userId, assetIds) {
      if (assetIds.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: {
          id: { in: assetIds.map((id) => BigInt(id)) },
          user_id: BigInt(userId),
          is_delete: false,
          material_id: { not: null },
        },
        select: { material_id: true },
      });
      return rows
        .map((row) => row.material_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    },
  };
}
