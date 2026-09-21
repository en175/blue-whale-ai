// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 素材与能力解析：输入素材投影、图片能力查询、产物落库。
import type {PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import {DEFAULT_IMAGE_REFERENCE_MAX} from "./model-capability-repo.js";
import type {WorkerRepo} from "./generation-worker-types.js";

/** IKDD4Z：查当前项目显式关联的素材 id（project_asset 跨项目复用，is_delete=0）。
 *  与 snapshot-repo.ts 的「项目可用素材」语义对齐：关联命中的素材即使 assets.project_id
 *  指向别项目（跨项目复用）也视为本项目可用。 */
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
      // IKDD4Z：归属 = 本项目直接归属 ∪ 全局素材(project_id=0) ∪ project_asset 显式关联（跨项目复用）。
      const linkedAssetIds = await findLinkedAssetIds(prisma, userId, projectId);
      const rows = await prisma.assets.findMany({
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
          // IKDJNZ：关联素材库素材 id（生成时命中走 asset://，不走 url）。
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
      // IKARDY：源视频资产解析——返回 storageKey + 公网 url 供下载（资产 public-read）；
      // 归属 = 同项目或共享 + 同用户（IKDD4Z 增 project_asset 跨项目复用分支）。
      const linkedAssetIds = await findLinkedAssetIds(prisma, userId, projectId);
      const row = await prisma.assets.findFirst({
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
      const features = (cap.features ?? {}) as {
        imageReferenceMax?: number;
        image_reference_max?: number;
      };
      // IKA72G：能力快照带参考图上限（与创建校验同源）。
      // IKHEXG：键名并入 `image_reference_max`；此处是图片 worker，缺省取图片/视频口径 10
      // （音频链路的 1 是另一个常量，见 model-capability-repo 的 DEFAULT_IMAGE_REFERENCE_MAX_FOR_AUDIO）。
      return {
        model_id: cap.model_id,
        api_size: apiSize,
        width,
        height,
        image_reference_max:
          features.imageReferenceMax ??
          features.image_reference_max ??
          DEFAULT_IMAGE_REFERENCE_MAX,
        channel_parser:
          typeof cap.channel_parser === "string" && cap.channel_parser.length > 0
            ? cap.channel_parser
            : "seedream",
        request_mapping: cap.request_mapping ?? null,
        default_size: cap.default_size,
        default_aspect_ratio: cap.default_aspect_ratio,
      };
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
