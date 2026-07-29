import { ok } from "@blue-whale/contracts";
import type { AssetRepo } from "@blue-whale/persistence";

export interface ListAssetsQuery {
  type?: string;
  page: number;
  size: number;
}

/** GET /api/assets：当前用户资产库分页（type 过滤，创建时间倒序）。
 *  对齐 Java AssetService.listAssets。 */
export async function handleListAssets(
  userId: string,
  query: ListAssetsQuery,
  deps: { assets: Pick<AssetRepo, "listByUser"> },
) {
  const page = await deps.assets.listByUser(userId, {
    type: query.type,
    page: query.page,
    size: query.size,
  });
  return ok(page);
}
