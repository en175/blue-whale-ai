// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 素材与能力解析：输入素材投影、图片能力查询、产物落库。
import type {PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import type {WorkerRepo} from "./generation-worker-types.js";

export function createWorkerAssetOps(prisma: PrismaClient): Pick<WorkerRepo, "resolveInputAssets" | "findImageCapability" | "createAsset"> {
  return {
    async resolveInputAssets(assetIds, userId, projectId) {
      if (assetIds.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: {
          id: { in: assetIds.map((id) => BigInt(id)) },
          user_id: BigInt(userId),
          OR: [{ project_id: BigInt(projectId) }, { project_id: BigInt(0) }],
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
          duration: true,
          duration_ms: true,
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
                  row.duration_ms === null
                    ? row.duration
                    : row.duration_ms / 1000,
              },
            ]
          : [];
      });
    },

    async findImageCapability(modelId, sizeId) {
      const cap = await prisma.generation_model_capability.findFirst({
        where: { model_id: modelId, enabled: true, is_delete: false },
      });
      if (!cap) return null;
      let apiSize: string | null = null;
      let width: number | null = null;
      let height: number | null = null;
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
          width = (match.width as number) ?? null;
          height = (match.height as number) ?? null;
        }
      }
      return { model_id: cap.model_id, api_size: apiSize, width, height };
    },

    async createAsset(input) {
      return prisma.$transaction(async (tx) => {
        // IK7GRP：fence CAS 守卫——镜像视频 publishVideoResult 的 updateMany 占位模式，
        // 用 version 自增做无业务副作用的原子占位（不改 status，job 仍是 processing，
        // 同一 worker 后续每张素材的 createAsset 都能通过）。count≠1 即 stale worker，返回 null。
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
        const asset = await tx.assets.create({
          data: {
            user_id: BigInt(input.user_id),
            project_id: BigInt(input.project_id),
            generation_job_id: BigInt(input.generation_job_id),
            type: input.type,
            url: input.url,
            storage_key: input.storage_key,
            mime: input.mime,
            size: input.size == null ? null : BigInt(input.size),
            duration: input.duration == null ? null : input.duration,
            width: input.width,
            height: input.height,
            source: "generated",
            status: "normal",
          },
        });
        await appendProjectEvent(tx, {
          projectId: input.project_id,
          eventType: "asset.created",
          aggregateType: "asset",
          aggregateId: asset.id.toString(),
          aggregateVersion: asset.version,
          correlationId: `job_${input.generation_job_id}`,
          payload: {
            asset_id: asset.id.toString(),
            generation_job_id: input.generation_job_id,
            type: asset.type,
            access_url: asset.url,
          },
        });
        return asset.id.toString();
      });
    },
  };
}
