import { fail, ok } from "@blue-whale/contracts";
import type { AssetRepo } from "@blue-whale/persistence";

/** 逻辑删除当前用户拥有的素材；不存在与越权统一返回资源不存在。 */
export async function handleDeleteAsset(
  userId: string,
  assetId: string,
  deps: { assets: Pick<AssetRepo, "softDeleteOwned"> },
) {
  const deleted = await deps.assets.softDeleteOwned(assetId, userId);
  return deleted ? ok(null) : fail(100301, "资源不存在");
}
