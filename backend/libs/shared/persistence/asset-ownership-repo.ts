import type {PrismaClient} from "@prisma/client";

import type {AssetOwnershipOps} from "./asset-ownership-types.js";

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
