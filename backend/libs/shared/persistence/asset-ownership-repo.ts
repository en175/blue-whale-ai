// 从原 generation-worker-repo.ts 拆出并裁剪（worker 退役后仅保留 API 侧归属查询）。
// 素材归属解析：提交任务时复用 worker 的归属逻辑（单份不漂移）。
import type {PrismaClient} from "@prisma/client";

import type {AssetOwnershipOps} from "./asset-ownership-types.js";

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

export function createAssetOwnershipOps(prisma: PrismaClient): Pick<AssetOwnershipOps, "resolveInputAssets"> {
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
  };
}
