import { fail, ok } from "@blue-whale/contracts";
import {
  assetDurationSeconds,
  type AssetRepo,
} from "@blue-whale/persistence";

export async function handleGetAsset(
  userId: string,
  assetId: string,
  deps: { assets: Pick<AssetRepo, "findOwnedSource"> },
) {
  const asset = await deps.assets.findOwnedSource(assetId, userId);
  if (!asset) return fail(100301, "资源不存在");
  return ok({
    asset_id: assetId,
    status: "ready" as const,
    type: asset.type,
    url: asset.url,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    duration: assetDurationSeconds(asset.duration, asset.duration_ms),
    mime: asset.mime ?? "application/octet-stream",
    size: Number(asset.size ?? BigInt(0)),
  });
}
