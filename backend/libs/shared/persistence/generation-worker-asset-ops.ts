import type {PrismaClient} from "@prisma/client";

import {DEFAULT_IMAGE_REFERENCE_MAX} from "./model-capability-repo.js";
import {parseStoredChannel} from "../generation/image-channel-parser.js";
import type {WorkerRepo} from "./generation-worker-types.js";

async function findLinkedAssetIds(
  prisma: PrismaClient,
  userId: string,
  projectId: string,
): Promise<bigint[]> {
  const rows = await prisma.project_asset.findMany({
    where: {
      user_id: BigInt(userId),
      project_id: BigInt(projectId),
      is_delete: 0,
    },
    select: { asset_id: true },
  });
  return rows.map((r) => r.asset_id);
}

export function createWorkerAssetOps(prisma: PrismaClient): Pick<WorkerRepo, "resolveInputAssets" | "resolveMediaExtractSource" | "findImageCapability" | "createAsset"> {
  return {
    async resolveInputAssets(assetIds, userId, projectId) {
      if (assetIds.length === 0) return [];
      const linkedAssetIds = await findLinkedAssetIds(prisma, userId, projectId);
      const rows = await prisma.user_assets.findMany({
        where: {
          id: { in: assetIds.map((id) => BigInt(id)) },
          user_id: BigInt(userId),
          OR: [
            { project_id: BigInt(projectId) },
            { project_id: BigInt(0) },
            ...(linkedAssetIds.length > 0 ? [{ id: { in: linkedAssetIds } }] : []),
          ],
          status: "normal",
          is_delete: false,
        },
        select: {
          id: true,
          type: true,
          url: true,
          mime: true,
          size: true,
          width: true,
          height: true,
          duration_ms: true,
          material_id: true,
        },
      });
      const byId = new Map(rows.map((row) => [row.id.toString(), row]));
      return assetIds.flatMap((id) => {
        const row = byId.get(id);
        return row
          ? [
              {
                id,
                type: row.type,
                url: row.url,
                mime: row.mime,
                size: row.size === null ? null : Number(row.size),
                width: row.width,
                height: row.height,
                duration:
                  row.duration_ms === null ? null : row.duration_ms / 1000,
                material_id: row.material_id,
              },
            ]
          : [];
      });
    },

    async resolveMediaExtractSource(assetId, userId, projectId) {
      const linkedAssetIds = await findLinkedAssetIds(prisma, userId, projectId);
      const row = await prisma.user_assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          OR: [
            { project_id: BigInt(projectId) },
            { project_id: BigInt(0) },
            ...(linkedAssetIds.length > 0 ? [{ id: { in: linkedAssetIds } }] : []),
          ],
          status: "normal",
          is_delete: false,
        },
        select: { storage_key: true, url: true, mime: true, type: true },
      });
      if (!row || !row.storage_key) return null;
      return { storageKey: row.storage_key, mime: row.mime, url: row.url };
    },

    async findImageCapability(modelId, sizeId) {
      const cap = await prisma.catalog_models.findFirst({
        where: { model_id: modelId, enabled: true, is_delete: false },
      });
      if (!cap) return null;
      let apiSize: string | null = null;
      if (sizeId && Array.isArray(cap.supported_sizes)) {
        const match = (
          cap.supported_sizes as Array<Record<string, unknown>>
        ).find(
          (s) =>
            s?.id === sizeId ||
            s?.api_value === sizeId ||
            s?.apiValue === sizeId,
        );
        if (match) {
          apiSize =
            (match.api_value as string) ?? (match.apiValue as string) ?? null;
        }
      }
      const features = (cap.features ?? {}) as {
        imageReferenceMax?: number;
        image_reference_max?: number;
      };
      return {
        model_id: cap.model_id,
        api_size: apiSize,
        image_reference_max:
          features.imageReferenceMax ??
          features.image_reference_max ??
          DEFAULT_IMAGE_REFERENCE_MAX,
        channel: parseStoredChannel(cap.channel, cap.capability_type),
        request_mapping: cap.request_mapping ?? null,
        default_size: cap.default_size,
        default_aspect_ratio: cap.default_aspect_ratio,
      };
    },

    async createAsset(input) {
      return prisma.$transaction(async (tx) => {
        const owned = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.generation_job_id),
            status: "processing",
            lease_owner: input.workerId,
            fencing_token: BigInt(input.fencingToken),
          },
          data: { version: { increment: 1 } },
        });
        if (owned.count !== 1) return null;
        const asset = await tx.user_assets.create({
          data: {
            user_id: BigInt(input.user_id),
            project_id: BigInt(input.project_id),
            generation_job_id: BigInt(input.generation_job_id),
            type: input.type,
            url: input.url,
            storage_key: input.storage_key,
            mime: input.mime,
            size: input.size == null ? null : BigInt(input.size),
            duration_ms:
              input.duration === null || input.duration === undefined
                ? null
                : Math.round(input.duration * 1000),
            width: input.width,
            height: input.height,
            source: "generated",
            status: "normal",
          },
        });
        return asset.id.toString();
      });
    },
  };
}
