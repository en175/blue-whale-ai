import {
  ASSET_UNAVAILABLE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { AssetRepo, ProjectRepo } from "@blue-whale/persistence";

import type { AssetSigner } from "./ports";

/** GET /api/projects/{projectId}/assets/{assetId}：签发资产短期可访问 URL。
 *  对齐 Java ProjectAssetAccessService.sign → AssetAccessResponse { url, expires_at }。
 *  归属/状态不满足 → 100301；storage_key 空 / 未配置 signer / 签名失败 → 100202。 */
export async function handleAccessAsset(
  userId: string,
  projectId: string,
  assetId: string,
  deps: {
    project: ProjectRepo;
    assets: AssetRepo;
    /** 未配置 signer（null）时等价 Java ObjectProvider.getIfAvailable()==null → 100202。 */
    signer: AssetSigner | null;
  },
) {
  const project = await deps.project.findOwnedById(projectId, userId);
  if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const asset = await deps.assets.findAccessible(projectId, assetId, userId);
  if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  if (!asset.storage_key || asset.storage_key.trim() === "") {
    return fail(ASSET_UNAVAILABLE_CODE, "资源不可用");
  }
  if (!deps.signer) return fail(ASSET_UNAVAILABLE_CODE, "资源不可用");

  try {
    const signed = await deps.signer.sign(asset.storage_key);
    return ok({
      url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
    });
  } catch {
    return fail(ASSET_UNAVAILABLE_CODE, "资源不可用");
  }
}
